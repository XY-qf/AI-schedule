#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
硅基流动接口诊断脚本（只用标准库，不需要 pip install）

用法（在项目根目录）：
    python scripts/ai-probe.py --key sk-xxxx
    python scripts/ai-probe.py                # 会提示你输入 Key
    python scripts/ai-probe.py --key sk-xxx --image "C:\\path\\to\\课表.png"
    python scripts/ai-probe.py --key sk-xxx --insecure    # 证书校验失败时再试

它会依次检查：DNS → TCP → TLS 证书 → /models → 普通对话 → 工具调用 → 流式 → 图片。
每一项都打印耗时和结果，最后给出结论。
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from typing import Any

DEFAULT_BASE = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"

# DeepSeek 官方没有「思考开关」，思考与否由模型名决定（deepseek-reasoner）；
# 第三方网关（硅基流动等）才认 enable_thinking / chat_template_kwargs。
def is_official(base: str) -> bool:
    host = base.split("//")[-1].split("/")[0].lower()
    return host == "deepseek.com" or host.endswith(".deepseek.com")


def thinking_flags(enabled: bool, base: str = DEFAULT_BASE) -> dict[str, Any]:
    if is_official(base):
        return {}
    return {"enable_thinking": enabled, "chat_template_kwargs": {"enable_thinking": enabled}}


def log(title: str, detail: str = "") -> None:
    print(f"\n=== {title} ===")
    if detail:
        print(detail)


def ok(msg: str) -> None:
    print(f"  [OK]   {msg}")


def bad(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def warn(msg: str) -> None:
    print(f"  [WARN] {msg}")


def read_stdin_body(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read().decode("utf-8", "replace")[:600]
    except Exception:  # noqa: BLE001
        return ""


def request(
    method: str,
    url: str,
    key: str,
    body: dict[str, Any] | None,
    timeout: float,
) -> tuple[int, dict[str, str], bytes, float]:
    """发一个请求，返回 (状态码, 响应头, 内容, 耗时秒)。"""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read(), time.time() - started
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers or {}), read_stdin_body(exc).encode("utf-8"), time.time() - started


def probe_dns(host: str) -> bool:
    log("1) DNS")
    try:
        started = time.time()
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        ips = sorted({item[4][0] for item in infos})
        ok(f"{host} -> {', '.join(ips)}（{(time.time() - started) * 1000:.0f} ms）")
        if any(ip.startswith("127.") or ip.startswith("10.") or ip.startswith("192.168.") for ip in ips):
            warn("解析到内网地址，可能有 hosts 改写或代理劫持")
        return True
    except OSError as exc:
        bad(f"解析失败：{exc}")
        return False


def probe_tls(host: str, insecure: bool) -> bool:
    log("2) TCP + TLS 证书")
    context = ssl.create_default_context()
    if insecure:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        warn("已跳过证书校验（--insecure）")
    try:
        started = time.time()
        sock = socket.create_connection((host, 443), timeout=15)
        ok(f"TCP 连接成功（{(time.time() - started) * 1000:.0f} ms）")
    except OSError as exc:
        bad(f"TCP 连不上：{exc}")
        return False
    try:
        tls_started = time.time()
        with context.wrap_socket(sock, server_hostname=host) as tls:
            cert = tls.getpeercert() or {}
            ok(f"TLS 握手成功（{(time.time() - tls_started) * 1000:.0f} ms）")
            issuer = dict(x[0] for x in cert.get("issuer", [])) if cert else {}
            subject = dict(x[0] for x in cert.get("subject", [])) if cert else {}
            org = issuer.get("organizationName", "?")
            print(f"         证书颁发者：{org}")
            print(f"         证书主体：{subject.get('commonName', '?')}")
            print(f"         有效期至：{cert.get('notAfter', '?')}")
            if "siliconflow" not in subject.get("commonName", "").lower():
                warn("证书主体不是 siliconflow，可能被中间人代理（公司网络常见）")
        return True
    except ssl.SSLError as exc:
        bad(f"TLS 握手失败：{exc}")
        warn("如果是证书错误，说明有中间人代理；可先试 --insecure 看服务本身是否可用")
        return False


def probe_models(base: str, key: str, timeout: float, keyword: str = "") -> None:
    log("3) GET /models（验证 Key 是否有效）")
    status, _headers, body, cost = request("GET", f"{base}/models", key, None, timeout)
    print(f"  HTTP {status}（{cost:.2f}s）")
    if status != 200:
        bad(body.decode("utf-8", "replace"))
        return
    try:
        payload = json.loads(body.decode("utf-8"))
        ids = [item.get("id", "") for item in payload.get("data", [])]
        ok(f"Key 可用，可见模型 {len(ids)} 个")
        if keyword:
            matched = [item for item in ids if keyword.lower() in item.lower()]
            print(f"  含「{keyword}」的模型 {len(matched)} 个：")
            for item in matched:
                print(f"         - {item}")
            return
        interesting = [item for item in ids if "Qwen" in item or "deepseek" in item.lower()]
        for item in interesting[:20]:
            print(f"         - {item}")
    except Exception as exc:  # noqa: BLE001
        warn(f"返回内容解析失败：{exc}")


def probe_chat(base: str, key: str, model: str, timeout: float, thinking: bool) -> None:
    log("4) 普通对话（非流式）", f"思考模式：{'开' if thinking else '关'}")
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": "只回复两个字：收到"}],
        "max_tokens": 16,
        "temperature": 0,
    }
    body.update(thinking_flags(thinking, base))
    status, _headers, raw, cost = request("POST", f"{base}/chat/completions", key, body, timeout)
    print(f"  HTTP {status}（{cost:.2f}s）")
    if status != 200:
        bad(raw.decode("utf-8", "replace"))
        return
    try:
        payload = json.loads(raw.decode("utf-8"))
        content = payload["choices"][0]["message"].get("content", "")
        ok(f"模型回答：{content!r}")
    except Exception as exc:  # noqa: BLE001
        warn(f"解析失败：{exc} / {raw[:200]!r}")


def probe_tools(base: str, key: str, model: str, timeout: float, thinking: bool) -> None:
    log("5) 工具调用（function calling）", f"思考模式：{'开' if thinking else '关'}")
    tools = [
        {
            "type": "function",
            "function": {
                "name": "add_courses",
                "description": "把课程加入待确认列表",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "courses": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "weekday": {"type": "integer"},
                                },
                                "required": ["title"],
                            },
                        }
                    },
                    "required": ["courses"],
                },
            },
        }
    ]
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是课程录入助手，只能通过工具调用写入课程。"},
            {"role": "user", "content": "周一 1-2 节高等数学，A101"},
        ],
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 256,
        "temperature": 0,
    }
    body.update(thinking_flags(thinking, base))
    status, _headers, raw, cost = request("POST", f"{base}/chat/completions", key, body, timeout)
    print(f"  HTTP {status}（{cost:.2f}s）")
    if status != 200:
        bad(raw.decode("utf-8", "replace"))
        return
    try:
        payload = json.loads(raw.decode("utf-8"))
        message = payload["choices"][0]["message"]
        calls = message.get("tool_calls") or []
        if calls:
            ok(f"返回 {len(calls)} 个工具调用：{calls[0].get('function', {}).get('name')}")
            print(f"         参数：{calls[0].get('function', {}).get('arguments', '')[:200]}")
        else:
            warn(f"没有工具调用，只有文本：{message.get('content', '')[:200]!r}")
    except Exception as exc:  # noqa: BLE001
        warn(f"解析失败：{exc} / {raw[:200]!r}")


def probe_stream(base: str, key: str, model: str, timeout: float, thinking: bool) -> None:
    log("6) 流式（SSE）", f"思考模式：{'开' if thinking else '关'}")
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": "用一句话介绍你自己"}],
        "stream": True,
        "max_tokens": 64,
        "temperature": 0,
    }
    body.update(thinking_flags(thinking, base))
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{base}/chat/completions", data=data, method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")

    started = time.time()
    first_byte_at: float | None = None
    events = 0
    data_events = 0
    samples: list[str] = []
    text = ""
    reasoning = ""
    tool_calls = 0
    finish_reason = ""
    empty_deltas = 0
    first_text_at: float | None = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            print(f"  HTTP {resp.status}")
            content_type = resp.headers.get("content-type", "?")
            encoding = resp.headers.get("transfer-encoding") or resp.headers.get("content-length", "?")
            print(f"  content-type: {content_type} / {encoding}")
            for raw in resp:
                if first_byte_at is None:
                    first_byte_at = time.time() - started
                    ok(f"首个数据包 {first_byte_at:.2f}s")
                events += 1
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                data_events += 1
                if len(samples) < 3:
                    samples.append(payload[:300])
                if payload == "[DONE]":
                    print("  收到 [DONE]")
                    break
                try:
                    obj = json.loads(payload)
                except Exception:  # noqa: BLE001
                    continue
                choice = (obj.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                piece = delta.get("content") or ""
                think = delta.get("reasoning_content") or ""
                calls = delta.get("tool_calls") or []
                if calls:
                    tool_calls += len(calls)
                if think:
                    reasoning += think
                if piece:
                    if first_text_at is None:
                        first_text_at = time.time() - started
                    text += piece
                if choice.get("finish_reason"):
                    finish_reason = str(choice.get("finish_reason"))
                if not piece and not think and not calls:
                    empty_deltas += 1
                if time.time() - started > timeout:
                    warn("超过时间预算，停止读取")
                    break

        print(f"  行数 {events}，data 事件 {data_events}，空 delta {empty_deltas}")
        if samples:
            print("  前几个 data 负载：")
            for sample in samples:
                print(f"         {sample}")
        ok(
            f"耗时 {(time.time() - started):.2f}s，正文 {len(text)} 字，思考 {len(reasoning)} 字，"
            f"工具调用 {tool_calls}，finish_reason={finish_reason or '-'}"
        )
        if first_text_at is not None:
            ok(f"首段正文 {first_text_at:.2f}s")
        elif reasoning:
            warn("收到的是 reasoning_content（思考内容），正文一条都没有 → 该模型/该端点默认开启深度思考")
            warn("程序里已经固定 enable_thinking=false；如果这样仍只有思考，请把这段输出发我")
        elif data_events == 0:
            warn("一个 data 事件都没有：可能被代理缓冲，或服务端没有按 SSE 返回")
        if text:
            print(f"         内容片段：{text[:120]!r}")
    except Exception as exc:  # noqa: BLE001
        bad(f"流式请求失败：{exc}")


def probe_image(base: str, key: str, model: str, timeout: float, image_path: str) -> None:
    log("7) 图片输入（多模态）")
    try:
        with open(image_path, "rb") as handle:
            raw = handle.read()
    except OSError as exc:
        bad(f"读不到图片：{exc}")
        return
    media = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    data_url = f"data:{media};base64,{base64.b64encode(raw).decode('ascii')}"
    print(f"  图片大小：{len(raw) / 1024:.0f} KB，base64 后约 {len(data_url) / 1024:.0f} KB")
    status, _headers, body, cost = request(
        "POST",
        f"{base}/chat/completions",
        key,
        {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "图里有什么？一句话概括。"},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "max_tokens": 64,
            "temperature": 0,
        },
        max(timeout, 60),
    )
    print(f"  HTTP {status}（{cost:.2f}s）")
    if status == 200:
        try:
            payload = json.loads(body.decode("utf-8"))
            ok(f"回答：{payload['choices'][0]['message'].get('content', '')[:120]!r}")
        except Exception:  # noqa: BLE001
            ok("请求成功（内容解析失败）")
    else:
        detail = body.decode("utf-8", "replace")
        bad(detail)
        if "image" in detail.lower() or "multimodal" in detail.lower():
            warn("这个模型不支持图片输入，改用文字描述即可")


def main() -> int:
    parser = argparse.ArgumentParser(description="硅基流动接口诊断")
    parser.add_argument("--key", default=os.environ.get("SILICONFLOW_API_KEY", ""))
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--image", default="")
    parser.add_argument("--insecure", action="store_true")
    parser.add_argument("--list", dest="list_keyword", default="", help="只列出包含该关键词的模型 id，例如 deepseek")
    parser.add_argument(
        "--thinking",
        action="store_true",
        help="开启深度思考（默认关闭，程序里也是关的）",
    )
    parser.add_argument("--skip-image", action="store_true")
    args = parser.parse_args()

    key = args.key.strip()
    if not key:
        key = getpass.getpass("请输入硅基流动 API Key（输入不显示）：").strip()
    if not key:
        print("没有 Key，退出。")
        return 2

    base = args.base.rstrip("/")
    host = urllib.request.urlparse(base).hostname or "api.siliconflow.cn"

    print(f"接口：{base}")
    print(f"模型：{args.model}")
    print(f"Key：{key[:4]}****{key[-4:] if len(key) > 8 else ''}")
    proxy = {k: v for k, v in os.environ.items() if k.lower() in ("http_proxy", "https_proxy", "all_proxy")}
    if proxy:
        print(f"代理：{proxy}")
    else:
        print("代理：未设置环境变量")

    if not probe_dns(host):
        print("\n结论：域名都解析不了，先检查网络/DNS。")
        return 1
    if not probe_tls(host, args.insecure):
        print("\n结论：TLS 握手失败。若有中间人代理，需要把代理证书装上，或用 --insecure 先确认服务本身是否可用。")
        return 1

    probe_models(base, key, args.timeout, args.list_keyword)
    if args.list_keyword:
        return 0
    print(f"深度思考：{'开' if args.thinking else '关（推荐，程序里也是关的）'}")
    probe_chat(base, key, args.model, args.timeout, args.thinking)
    probe_tools(base, key, args.model, max(args.timeout, 60), args.thinking)
    probe_stream(base, key, args.model, max(args.timeout, 45), args.thinking)
    if args.image and not args.skip_image:
        probe_image(base, key, args.model, args.timeout, args.image)

    print(
        "\n说明：\n"
        "  · /models 401 → Key 不对\n"
        "  · /models 200 但对话超时 → 网络到模型服务的通路被卡住（代理/防火墙）\n"
        "  · 对话 OK 但工具调用无返回 → 该模型不支持 function calling（程序会自动退回解析 JSON）\n"
        "  · 流式只有 reasoning_content 没有 content → 该模型默认深度思考，程序已固定关掉\n"
        "  · 图片测试报错 → 换成纯文字输入\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())