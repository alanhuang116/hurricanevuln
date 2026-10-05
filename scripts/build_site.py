"""Assemble docs/index.html (GitHub Pages) from web/site.html, web/app.js and web/bundle.json."""
from __future__ import annotations

import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REPO = os.environ.get("HV_REPO", "alanhuang116/hurricanevuln")


def main():
    w = lambda f: open(os.path.join(ROOT, "web", f), encoding="utf-8").read()  # noqa: E731
    html = w("site.html")
    assert "/*__BUNDLE__*/null" in html and "/*__APP__*/" in html
    html = html.replace("/*__BUNDLE__*/null", w("bundle.json")).replace("/*__APP__*/", w("app.js")).replace("__REPO__", REPO)
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    out = os.path.join(ROOT, "docs", "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
