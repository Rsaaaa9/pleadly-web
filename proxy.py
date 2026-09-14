#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pleadly 本地 CORS 代理
把浏览器的 AI 请求转发给 DeepSeek（或其它 OpenAI 兼容接口），并补上 CORS 响应头，
解决「浏览器直连 DeepSeek 被 CORS 拦截」导致的「调用失败 / 网络异常」。

用法：
    python proxy.py
然后在 Pleadly 设置里把 Base URL 填成 http://127.0.0.1:8787
"""
import json
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8787
UPSTREAM = "https://api.deepseek.com"  # 换别的厂商时改这里（OpenAI/Groq 等 OpenAI 兼容接口）

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _reply(self, status, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._reply(200, "Pleadly proxy OK (upstream: %s)" % UPSTREAM, "text/plain; charset=utf-8")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length)
            auth = self.headers.get("Authorization", "")
            ctype = self.headers.get("Content-Type", "application/json")

            url = UPSTREAM.rstrip("/") + self.path
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", ctype)
            if auth:
                req.add_header("Authorization", auth)

            with urllib.request.urlopen(req, timeout=180) as up:
                data = up.read()
                status = up.status
                up_type = up.headers.get("Content-Type", "application/json") or "application/json"
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
            up_type = e.headers.get("Content-Type", "application/json") or "application/json"
        except Exception as e:
            data = json.dumps({"error": "proxy error: %s" % e}, ensure_ascii=False).encode("utf-8")
            status = 502
            up_type = "application/json; charset=utf-8"
        self._reply(status, data, up_type)

    def log_message(self, fmt, *args):
        print("[proxy] " + (fmt % args), flush=True)

if __name__ == "__main__":
    print("Pleadly 本地代理已启动: http://127.0.0.1:%d  ->  %s" % (PORT, UPSTREAM), flush=True)
    print("请在 Pleadly 设置里把 Base URL 填成 http://127.0.0.1:%d ，保持本窗口开着即可。" % PORT, flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError as e:
        print("启动失败（端口被占用或权限不足）: %s" % e, flush=True)
