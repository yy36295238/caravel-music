#!/usr/bin/env python3
"""扫描缺词 MP3，预览 LRCLIB 匹配结果；传入 --download 后保存同名 LRC。"""

import argparse
import csv
import http.client
import json
import logging
import math
import os
import re
import ssl
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import certifi
    from mutagen.mp3 import MP3
    from opencc import OpenCC
except ImportError as error:
    raise SystemExit("请先安装依赖：python -m pip install -r scripts/lyrics-requirements.txt") from error

# 与播放器单份歌词限制一致；请求响应可包含多首候选，单独限制总大小。
MAX_LYRICS_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 8 * MAX_LYRICS_BYTES
TIME_TAG = re.compile(r"\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]")
META_TAG = re.compile(r"^\[(?:ar|ti|al|by|offset|length|re|ve):.*\]$", re.I)
LOG = logging.getLogger("lrclib")
# 报告仅记录匹配依据与来源，不保存歌词正文。
# 报告使用中文表头和状态，重试读取同时兼容旧版英文报告。
REPORT_COLUMNS = {
    "path": "歌曲相对路径", "title": "歌名", "artist": "歌手", "album": "专辑", "duration": "本地时长（秒）",
    "metadata_source": "信息来源", "status": "处理结果", "confidence": "匹配可信度",
    "candidate_title": "候选歌名", "candidate_artist": "候选歌手", "candidate_album": "候选专辑",
    "duration_delta": "时长差（秒）", "source": "歌词来源链接", "detail": "处理原因", "candidates": "参考候选",
}
STATUS_LABELS = {
    "downloaded_synced": "已下载同步歌词", "downloaded_plain": "已下载纯文本歌词",
    "preview_synced": "已匹配同步歌词（预览）", "preview_plain": "已匹配纯文本歌词（预览）",
    "no_match": "未匹配", "needs_review": "版本待确认", "instrumental": "纯音乐，无需歌词",
    "existing_lrc": "已有歌词，跳过",
    "embedded": "已有内嵌歌词，跳过", "local_extract_needed": "需提取本地内嵌歌词",
    "missing_metadata": "歌曲信息不足", "error": "查询或处理失败", "rate_limited": "服务限流，暂停",
    "service_unavailable": "服务持续不可用，暂停", "not_queried": "本次未查询",
}
# 只转换比较/查询文本，不回写原始标签；反向转换用于中文词库的检索回退。
SIMPLIFIED = OpenCC("t2s")
TRADITIONAL = OpenCC("s2t")
PROMO = re.compile(r"(?:电影|电视剧|影视|《[^》]+》).*(?:主题曲|插曲|片头曲|片尾曲|推广|宣传|重逢曲|挥别曲)")
# 版本标记与歌名分开比较，搜索省略标记不代表匹配时忽略版本。
VERSIONS = {
    "live": r"\blive\b|现场", "remix": r"\bremix\b|混音版",
    "instrumental": r"伴奏|纯音乐|\binstrumental\b|\bkaraoke\b",
    "acoustic": r"\bacoustic\b|不插电", "tv": r"\btv\s*version\b",
    "slow": r"慢版", "fast": r"快版", "full": r"全长版本|完整版",
    "cantonese": r"粤语(?:版)?", "mandarin": r"国语(?:版)?|普通话(?:版)?",
    "japanese": r"日语(?:版)?", "english": r"英语(?:版)?|英文版",
}
# 语言缺失与语言冲突分开处理；其余录音版本必须一致。
LANGUAGES = {"cantonese", "mandarin", "japanese", "english"}
CREDIT = re.compile(r"^(?:作词|作曲|编曲|词|曲|制作人|录音|混音|演唱|lyrics by|composed by)\s*[:：]", re.I)


def normalized(value):
    """忽略大小写、空白及标点，但保留 Live、语言等版本文字，避免误配。"""
    return "".join(c for c in SIMPLIFIED.convert(unicodedata.normalize("NFKC", value)).casefold() if c.isalnum())


def title_parts(value):
    """仅去掉可识别的影视说明，未知括号内容保留，避免同名版本被错误合并。"""
    text = SIMPLIFIED.convert(unicodedata.normalize("NFKC", value)).strip()
    # 版本标记可能位于宣传附注末尾，必须先提取，不能连同附注一起丢失。
    markers = {version for version, pattern in VERSIONS.items() if re.search(pattern, text, re.I)}
    text = re.sub(r"\([^()]*\)", lambda match: "" if PROMO.search(match[0]) else match[0], text)
    for match in re.finditer(r'\s*[-—－]\s*|\s+(?=(?:电影|电视剧)[《"“])', text):
        if PROMO.search(text[match.end():]):
            text = text[:match.start()]
            break
    for version, pattern in VERSIONS.items():
        if re.search(pattern, text, re.I):
            text = re.sub(pattern, "", text, flags=re.I)
    text = re.sub(r"\(\s*\)", "", text).strip(" -—")
    return text, markers


def artist_key(value):
    """合作歌手按集合比较，兼容逗号、&、顿号及顺序变化，不猜测歌手别名。"""
    return tuple(sorted(normalized(part) for part in re.split(r"[,，&、/;；]+", value) if normalized(part)))


def usable_text(text):
    """排除只有空白、元信息或时间标签的内容。"""
    return isinstance(text, str) and any(
        TIME_TAG.sub("", line).strip() and not META_TAG.fullmatch(line.strip())
        for line in text.splitlines()
    )


def sidecars(path):
    """保护已有同名歌词，包括大写扩展名、空文件和符号链接。"""
    return [p for p in path.parent.iterdir() if p.stem == path.stem and p.suffix.lower() == ".lrc"]


def inspect_track(path):
    """只读 MP3；标准内嵌歌词直接跳过，非标准歌词交由本地提取处理。"""
    if sidecars(path):
        return {"status": "existing_lrc", "detail": "已有同名 LRC，保留原文件"}
    audio = MP3(path)
    tags = audio.tags or {}
    title, artist = str(tags.get("TIT2", "")).strip(), str(tags.get("TPE1", "")).strip()
    # 仅识别明确序号，保留“7 rings”和“2002年的第一场雪”等数字歌名。
    stem = re.sub(r"^(?:\d+[.、_]\s*|\d{2,}\s+)", "", path.stem)
    # 不拆开 BYE-BYE 等英文连字符歌名，支持中文歌名单侧空格和无空格分隔符。
    parts = re.split(r"\s+[-—–]\s*|\s*[-—–]\s+|(?<=[\u4e00-\u9fff）)])[-—–](?=\S)", stem, maxsplit=1)
    parts = [part.strip() for part in parts]
    metadata_source = "ID3"
    # 编号歌单有时把整个文件名复制到歌名、把推广方写入歌手；只在结构明确时回退。
    numbered_pair = stem != path.stem and len(parts) == 2 and all(p.strip() for p in parts)
    generic_artist = normalized(artist) in {"华语群星", "群星", "variousartists", "未知歌手"}
    if numbered_pair and (not title or normalized(title) in (normalized(stem), normalized(path.stem)) or (generic_artist and normalized(title) == normalized(parts[0]))):
        title, artist = (parts[1], parts[0]) if artist and normalized(artist) == normalized(parts[0]) else (parts[0], parts[1])
        metadata_source = "编号文件名"
        LOG.warning("使用编号文件名补正歌曲信息：%s → %s / %s", path.name, title, artist)
    elif len(parts) == 2 and not artist and (normalized(title) == normalized(parts[0]) or normalized(path.parent.name) == normalized(parts[1])):
        title, artist = parts
        metadata_source = "文件名回退"
    elif not title:
        title = parts[1] if len(parts) == 2 and (not artist or normalized(parts[0]) == normalized(artist)) else stem
        metadata_source = "文件名回退"
    if not artist and len(parts) == 2 and normalized(parts[1]) == normalized(title):
        artist = parts[0]
        metadata_source = "文件名回退"
    track = {"title": title, "artist": artist, "album": str(tags.get("TALB", "")).strip(),
             "duration": round(audio.info.length, 3), "metadata_source": metadata_source}
    for frame in tags.values():
        text = getattr(frame, "text", "")
        if frame.FrameID == "USLT" and usable_text(text):
            return {**track, "status": "embedded", "detail": "已有 ID3 USLT 内嵌歌词"}
    for frame in tags.values():
        text = getattr(frame, "text", "")
        if isinstance(text, list):
            text = "\n".join(str(item) for item in text)
        custom_lyrics = frame.FrameID == "TXXX" and normalized(getattr(frame, "desc", "")) in ("lyrics", "unsyncedlyrics") and usable_text(text)
        if custom_lyrics or (frame.FrameID == "SYLT" and text) or (isinstance(text, str) and len(TIME_TAG.findall(text)) >= 3):
            return {**track, "status": "local_extract_needed", "detail": f"已有 {frame.FrameID} 非标准或同步歌词，需本地提取"}
    if not title or not artist or not math.isfinite(track["duration"]) or track["duration"] <= 0:
        return {**track, "status": "missing_metadata", "detail": "缺少歌名、歌手或有效时长，需先补全元数据"}
    return track


class RateLimitedError(RuntimeError):
    """限流无法在短时间内恢复时停止本批查询，避免继续冲击服务。"""


class ServiceUnavailableError(RuntimeError):
    """连续请求耗尽重试时暂停整批，避免持续重试失效服务。"""


class LRCLIBClient:
    """串行限速访问官方 API；证书验证保持开启，不改动用户代理设置。"""

    def __init__(self):
        self.context = ssl.create_default_context(cafile=certifi.where())
        self.last_request = 0.0
        self.cache = {}
        # 连续耗尽重试的网络请求数；成功响应会清零。
        self.failures = 0

    def failed(self, error):
        """只对耗尽重试的请求累计连续失败，成功请求会重置计数。"""
        self.failures += 1
        if self.failures >= 3:
            raise ServiceUnavailableError("连续3次查询耗尽重试，本批暂停；请稍后按报告重试") from error
        raise error

    def search(self, title, artist):
        """相同曲目复用响应；只重试网络错误、服务端错误及短期限流。"""
        key = (title, artist)
        if key in self.cache:
            return self.cache[key]
        url = "https://lrclib.net/api/search?" + urlencode({"track_name": title, "artist_name": artist})
        request = Request(url, headers={"User-Agent": "Liusheng-Lyrics/0.1 (https://github.com/yy36295238/caravel-music)",
                                        "Accept": "application/json"})
        for attempt in range(3):
            time.sleep(max(0, 1 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            LOG.info("查询 LRCLIB：%s / %s（尝试 %s/3）", title, artist, attempt + 1)
            try:
                with urlopen(request, timeout=20, context=self.context) as response:
                    data = response.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise ValueError("API 响应超过 8 MiB")
                records = json.loads(data)
                if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
                    raise ValueError("API 返回格式不符合预期")
                self.cache[key] = records
                self.failures = 0
                return records
            except HTTPError as error:
                error.close()
                delay = 5 * 3 ** attempt
                if error.code in (429, 503):
                    retry_after = error.headers.get("Retry-After", "")
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        try:
                            delay = (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
                        except (TypeError, ValueError, OverflowError):
                            pass
                    if not math.isfinite(delay) or delay > 60:
                        error_type = RateLimitedError if error.code == 429 else ServiceUnavailableError
                        raise error_type("服务要求较长等待，本批暂停；请稍后按报告重试") from error
                    if attempt == 2:
                        if error.code == 429:
                            raise RateLimitedError("LRCLIB 限流，本批查询已停止；请稍后重跑") from error
                        self.failed(error)
                elif error.code not in (500, 502, 503, 504) or attempt == 2:
                    if error.code in (500, 502, 504):
                        self.failed(error)
                    raise
                LOG.warning("查询失败 HTTP %s：%s / %s，%.1f 秒后重试", error.code, title, artist, max(1, delay))
                time.sleep(max(1, delay))
            except (URLError, TimeoutError, ConnectionError, http.client.HTTPException) as error:
                if attempt == 2:
                    self.failed(error)
                LOG.warning("查询失败：%s / %s，原因：%s", title, artist, error)
                time.sleep(5 * 3 ** attempt)


def lyric_payload(record, duration):
    """优先同步歌词，校验体积、时间标签及 offset 后的时间；异常同步数据回退纯文本。"""
    for kind, field in (("synced", "syncedLyrics"), ("plain", "plainLyrics")):
        text = record.get(field)
        if not usable_text(text):
            continue
        text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff").strip() + "\n"
        if len(text.encode("utf-8")) > MAX_LYRICS_BYTES or len(text.splitlines()) > 10000:
            continue
        if kind == "synced":
            stamps = TIME_TAG.findall(text)
            offset = lyric_offset(text)
            times = [int(m) * 60 + int(s) + float("0." + (fraction or "0")) - offset for m, s, fraction in stamps]
            numeric_tags = re.findall(r"\[\d+:[^\]]*\]", text)
            if (not times or len(times) > 10000 or min(times) < -3 or max(times) > duration + 3
                    or any(not TIME_TAG.fullmatch(tag) for tag in numeric_tags)):
                continue
        return kind, text
    return None


def lyric_offset(text):
    """与播放器一致使用最后一个毫秒偏移值，避免只比较原始时间标签。"""
    offsets = re.findall(r"\[offset:([+-]?\d{1,9})\]", text, re.I)
    return int(offsets[-1]) / 1000 if offsets else 0


def lyric_signature(payload):
    """忽略署名、标点及繁简差异；正文与有效时间轴分别比较，不改写下载内容。"""
    _, text = payload
    words, timeline = [], []
    offset = lyric_offset(text)
    for line in text.splitlines():
        if META_TAG.fullmatch(line.strip()):
            continue
        body = re.sub(r"<\d+:[0-5]\d(?:\.\d{1,3})?>", "", TIME_TAG.sub("", line)).strip()
        if CREDIT.match(body) or not normalized(body):
            continue
        word = normalized(body)
        words.append(word)
        for minute, second, fraction in TIME_TAG.findall(line):
            timeline.append((word, int(minute) * 60 + int(second) + float("0." + (fraction or "0")) - offset))
    return "".join(words), sorted(timeline, key=lambda item: item[1])


def same_timing(left, right):
    """同一正文的时间轴只允许小幅制作误差；明显错位或分行不同仍需复核。"""
    return len(left) == len(right) and all(a[0] == b[0] and abs(a[1] - b[1]) <= 0.6 for a, b in zip(left, right))


def choose_candidate(track, records):
    """分阶段记录排除原因，按录音版本、专辑和时间精度选择可自动保存的候选。"""
    base, versions = title_parts(track["title"])
    matches, rejected = [], Counter()
    for record in records:
        if not isinstance(record.get("id"), int):
            continue
        candidate_base, candidate_versions = title_parts(str(record.get("trackName") or ""))
        if normalized(candidate_base) != normalized(base):
            rejected["歌名不符"] += 1
            continue
        if artist_key(str(record.get("artistName") or "")) != artist_key(track["artist"]):
            rejected["歌手不符"] += 1
            continue
        language, candidate_language = versions & LANGUAGES, candidate_versions & LANGUAGES
        if versions - LANGUAGES != candidate_versions - LANGUAGES or (language and candidate_language and language != candidate_language):
            rejected["录音版本不符"] += 1
            continue
        try:
            delta = abs(float(record["duration"]) - track["duration"])
        except (KeyError, ValueError, TypeError):
            rejected["时长无效"] += 1
            continue
        if not math.isfinite(delta) or delta > 8:
            rejected["时长差超过8秒"] += 1
            continue
        payload = lyric_payload(record, track["duration"])
        if not payload and record.get("instrumental") is not True:
            rejected["歌词为空或时间轴异常"] += 1
            continue
        album = bool(track["album"] and normalized(str(record.get("albumName") or "")) == normalized(track["album"]))
        # 3～8 秒差异仅在同专辑且有有效同步歌词时进入自动候选；语言单边缺失不猜测。
        automatic = language == candidate_language and (delta <= 3 or (album and payload and payload[0] == "synced"))
        matches.append({"record": record, "payload": payload, "delta": delta, "album": album, "automatic": bool(automatic)})
    if not matches:
        reasons = "；".join(f"{reason} {count} 条" for reason, count in rejected.items())
        return "no_match", None, ("接口未返回候选" if not records else "候选均被排除：" + reasons)
    automatic = [m for m in matches if m["automatic"]]
    if not automatic:
        return "needs_review", None, "候选语言标记不完整，或时长差3～8秒但缺少同专辑同步歌词依据"
    matches = automatic
    album_matches = [m for m in matches if m["album"]]
    matches = album_matches or matches
    instrumental = [m for m in matches if m["record"].get("instrumental") is True]
    if instrumental:
        if len(instrumental) == len(matches) and not any(m["payload"] for m in matches):
            return "instrumental", None, "候选标为纯音乐，无需写入空歌词"
        return "needs_review", None, "候选的纯音乐标记存在冲突"
    synced = [m for m in matches if m["payload"][0] == "synced"]
    matches = sorted(synced or matches, key=lambda m: (m["delta"], m["record"]["id"]))
    selected = matches[0]
    signatures = [lyric_signature(m["payload"]) for m in matches]
    if len({signature[0] for signature in signatures}) > 1:
        return "needs_review", None, f"同级候选仍有不同正文（{len(matches)}条），不按最近时长强行选择"
    if not all(same_timing(signatures[0][1], other[1]) for other in signatures[1:]):
        # 同专辑且时长明显更接近，可选出唯一的优先候选；没有足够差距则保留人工确认。
        if not (selected["album"] and selected["delta"] <= 0.5 and matches[1]["delta"] - selected["delta"] >= 1):
            return "needs_review", None, "正文相同但时间轴差异超过0.6秒或分行不同，无法确定最合适版本"
    detail = f"时长差 {selected['delta']:.3f} 秒；" + ("同专辑优先" if selected["album"] else "歌名、歌手和版本一致")
    if len(matches) > 1:
        detail += "；已比较重复候选的正文和时间轴"
    return selected["payload"][0], (selected["record"], selected["payload"], selected["delta"]), detail


def search_track(client, track):
    """原始查询未得到确定匹配时，尝试基础歌名及繁体查询；最终仍核对版本标记。"""
    base, _ = title_parts(track["title"])
    variants = [(track["title"], track["artist"]), (base, SIMPLIFIED.convert(track["artist"])),
                (TRADITIONAL.convert(base), TRADITIONAL.convert(track["artist"]))]
    records = {}
    for index, (title, artist) in enumerate(dict.fromkeys(variants)):
        if index:
            LOG.info("回退检索：%s / %s（仍校验录音版本）", title, artist)
        for record in client.search(title, artist):
            if isinstance(record.get("id"), int):
                records[record["id"]] = record
        status, selected, detail = choose_candidate(track, list(records.values()))
        if selected or status == "instrumental":
            break
    return status, selected, detail, list(records.values())


def candidate_fields(track, records, selected):
    """报告只展示候选元数据与链接，不把歌词正文写入 CSV。"""
    def distance(record):
        try:
            value = abs(float(record.get("duration")) - track["duration"])
            return value if math.isfinite(value) else math.inf
        except (ValueError, TypeError):
            return math.inf
    nearest = sorted(records, key=distance)[:3]
    fields = {"candidates": " | ".join(
        f"{r.get('trackName', '')} / {r.get('artistName', '')} / {r.get('albumName', '')} / 差{distance(r):.3f}秒 / https://lrclib.net/api/get/{r['id']}"
        for r in nearest)}
    if selected:
        record, _, delta = selected
        fields.update(candidate_title=record.get("trackName", ""), candidate_artist=record.get("artistName", ""),
                      candidate_album=record.get("albumName", ""), duration_delta=round(delta, 3), confidence="高" if delta <= 3 else "较高（同专辑）")
    return fields


def write_report_row(writer, row):
    """中文化报告值，保留完整相对路径，供后续重试定位原歌曲。"""
    result = {label: row.get(key, "") for key, label in REPORT_COLUMNS.items()}
    result[REPORT_COLUMNS["status"]] = STATUS_LABELS.get(row["status"], row["status"])
    writer.writerow(result)


def retry_paths(report, root):
    """兼容旧英文/新中文报告，只选择未完成项并校验路径不能越出音乐目录。"""
    unresolved = {"no_match", "needs_review", "error", "rate_limited", "service_unavailable", "missing_metadata", "not_queried", "local_extract_needed"}
    reverse = {label: code for code, label in STATUS_LABELS.items()}
    selected = set()
    with report.expanduser().open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not ({"path", "status"}.issubset(reader.fieldnames or []) or {"歌曲相对路径", "处理结果"}.issubset(reader.fieldnames or [])):
            raise ValueError("重试报告缺少歌曲路径或处理结果列")
        for row in reader:
            status = row.get("status") or row.get("处理结果", "")
            if reverse.get(status, status) not in unresolved:
                continue
            relative = row.get("path") or row.get("歌曲相对路径", "")
            path = (root / relative).resolve()
            if not relative or Path(relative).is_absolute() or not path.is_relative_to(root) or path.suffix.lower() != ".mp3":
                raise ValueError(f"重试报告包含无效音乐路径：{relative}")
            selected.add(path)
    return selected


def save_lyrics(path, text):
    """写入前再次查重，排他创建防止重复运行覆盖；写入失败清理本次文件。"""
    if sidecars(path):
        raise FileExistsError("同名歌词已存在，未覆盖")
    destination = path.with_suffix(".lrc")
    with destination.open("x", encoding="utf-8", newline="\n") as output:
        try:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        except BaseException:
            output.close()
            destination.unlink(missing_ok=True)
            raise
    LOG.info("已保存歌词：%s", destination)


def scan_tracks(paths, root, writer, output, counts):
    """先检查全库，确定待补总数；已有歌词和读取失败即时写入报告。"""
    pending = []
    for index, path in enumerate(paths, 1):
        row = {"path": str(path.relative_to(root))}
        try:
            row.update(inspect_track(path))
        except Exception as error:
            row.update(status="error", detail=str(error))
            LOG.exception("扫描读取失败：%s", row["path"])
        if "status" in row:
            counts[row["status"]] += 1
            write_report_row(writer, row)
            output.flush()
        else:
            pending.append(row)
        if index % 100 == 0 or index == len(paths):
            LOG.info("本地扫描 [%s/%s]：已找到 %s 首待补歌词歌曲", index, len(paths), len(pending))
    return pending


def log_progress(counts, completed, planned, download, scan_errors):
    """进度只计算本次计划查询的歌曲；重试不重复计数，未匹配不算失败。"""
    synced, plain = counts["downloaded_synced"], counts["downloaded_plain"]
    percent = completed / planned * 100 if planned else 100
    result = f"已下载 {synced + plain}（同步 {synced} / 纯文本 {plain}）"
    if not download:
        result = f"预览匹配 {counts['preview_synced'] + counts['preview_plain']} | 已下载 0（预览不写入）"
    LOG.info(
        "查询进度 [%s/%s %.1f%%] | %s | 未匹配 %s | 待确认 %s | 失败 %s | 纯音乐 %s | 剩余待查询 %s",
        completed, planned, percent, result, counts["no_match"], counts["needs_review"],
        counts["error"] - scan_errors + counts["rate_limited"] + counts["service_unavailable"], counts["instrumental"], max(0, planned - completed),
    )


def main(argv=None):
    """逐首记录结果，单曲失败不终止整批；中断时保留已经完成的 CSV 行。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="MP3 根目录，递归扫描子目录")
    parser.add_argument("--download", action="store_true", help="写入匹配的歌词；默认仅预览")
    parser.add_argument("--limit", type=int, default=0, help="最多查询多少首缺词歌曲，0 表示全部")
    parser.add_argument("--report", type=Path, help="CSV 报告路径，默认保存在音乐根目录；不覆盖已有报告")
    parser.add_argument("--retry-report", type=Path, help="只处理旧报告中的失败、未匹配、待确认及未查询歌曲")
    args = parser.parse_args(argv)
    root = args.directory.expanduser().resolve()
    if not root.is_dir() or args.limit < 0:
        parser.error("音乐目录必须存在，--limit 不能为负数")
    report = (args.report.expanduser() if args.report else root / f"lrclib-report-{datetime.now():%Y%m%d-%H%M%S-%f}.csv")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    paths = sorted(p for p in root.rglob("*") if p.suffix.lower() == ".mp3" and p.is_file() and not p.is_symlink())
    if not paths:
        parser.error("目录中没有可扫描的 MP3")
    if args.retry_report:
        try:
            selected_paths = retry_paths(args.retry_report, root)
        except (OSError, ValueError) as error:
            parser.error(f"无法读取重试报告：{error}")
        all_count = len(paths)
        paths = [path for path in paths if path.resolve() in selected_paths]
        LOG.info("重试范围：目录共 %s 首，报告选中 %s 首，仍存在 %s 首", all_count, len(selected_paths), len(paths))
        if not paths:
            LOG.info("没有可重试的歌曲")
            return 0
    client, counts, queried, stopped = LRCLIBClient(), Counter(), 0, ""
    planned, scan_errors, pending = 0, 0, None
    LOG.info("扫描总数：%s 首 MP3（已有歌词会跳过）；模式：%s", len(paths), "下载" if args.download else "预览")
    LOG.info("报告：%s", report)
    try:
        with report.open("x", encoding="utf-8-sig", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=list(REPORT_COLUMNS.values()))
            writer.writeheader()
            pending = scan_tracks(paths, root, writer, output, counts)
            scan_errors = counts["error"]
            planned = min(args.limit, len(pending)) if args.limit else len(pending)
            LOG.info("扫描完成 | 总数 %s | 已有歌词跳过 %s（LRC %s / 内嵌 %s） | 待本地提取 %s | 缺元数据 %s | 读取失败 %s",
                     len(paths), counts["existing_lrc"] + counts["embedded"], counts["existing_lrc"], counts["embedded"],
                     counts["local_extract_needed"], counts["missing_metadata"], scan_errors)
            LOG.info("待补歌词 %s | 本次计划查询 %s | 超出查询上限 %s（匹配成功才下载）", len(pending), planned, len(pending) - planned)
            log_progress(counts, queried, planned, args.download, scan_errors)
            for row in pending:
                path = root / row["path"]
                attempted = False
                try:
                    if stopped:
                        row.update(status="not_queried", detail=stopped)
                    elif queried >= planned:
                        row.update(status="not_queried", detail="达到 --limit")
                    else:
                        attempted = True
                        LOG.info("正在处理 [%s/%s]：%s", queried + 1, planned, row["path"])
                        status, selected, detail, records = search_track(client, row)
                        row.update(status=status, detail=detail)
                        row.update(candidate_fields(row, records, selected))
                        if not selected:
                            row["confidence"] = "待确认" if status == "needs_review" else "未匹配"
                        if selected:
                            record, (kind, text), _ = selected
                            row["source"] = f"https://lrclib.net/api/get/{record['id']}"
                            row["status"] = "preview_" + kind
                            if args.download:
                                save_lyrics(path, text)
                                row["status"] = "downloaded_" + kind
                        LOG.info("匹配结果：%s → %s", row["path"], STATUS_LABELS.get(row["status"], row["status"]))
                except (RateLimitedError, ServiceUnavailableError) as error:
                    stopped = str(error)
                    row.update(status="rate_limited" if isinstance(error, RateLimitedError) else "service_unavailable", detail=str(error))
                    LOG.warning("%s：%s", row["path"], error)
                except FileExistsError as error:
                    row.update(status="existing_lrc", detail=str(error))
                    LOG.warning("%s：%s", row["path"], error)
                except Exception as error:
                    row.update(status="error", detail=str(error))
                    LOG.exception("处理失败：%s", row["path"])
                counts[row["status"]] += 1
                write_report_row(writer, row)
                output.flush()
                if attempted:
                    queried += 1
                    log_progress(counts, queried, planned, args.download, scan_errors)
    except KeyboardInterrupt:
        if pending is not None:
            log_progress(counts, queried, planned, args.download, scan_errors)
        LOG.warning("用户中断，已完成的结果保存在 %s", report)
        return 130
    except OSError as error:
        LOG.error("报告写入失败：%s，原因：%s", report, error)
        return 1
    LOG.info("%s | 总数 %s | 已有歌词跳过 %s | 初始待补 %s | 本次未查询 %s | 扫描读取失败 %s",
             "服务暂停" if stopped else "本次处理结束", len(paths), counts["existing_lrc"] + counts["embedded"],
             len(pending), counts["not_queried"], scan_errors)
    log_progress(counts, queried, planned, args.download, scan_errors)
    LOG.info("报告：%s", report)
    return 1 if counts["error"] or stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
