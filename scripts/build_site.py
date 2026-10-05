"""Assemble the GitHub Pages site in docs/: the product page (index.html) and
the technical documentation (documentation.html), both from web/ and the
build bundle."""
from __future__ import annotations

import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REPO = os.environ.get("HV_REPO", "alanhuang116/hurricanevuln")


def w(f):
    return open(os.path.join(ROOT, "web", f), encoding="utf-8").read()


def write(name, html):
    out = os.path.join(ROOT, "docs", name)
    open(out, "w", encoding="utf-8").write(html.replace("__REPO__", REPO))
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


def main():
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    bundle, app = w("bundle.json"), w("app.js")
    html = w("site.html")
    assert "/*__BUNDLE__*/null" in html and "/*__APP__*/" in html
    write("index.html", html.replace("/*__BUNDLE__*/null", bundle).replace("/*__APP__*/", app))

    a, b = app.index("/* ===== engine ===== */"), app.index("/* ===== end engine ===== */")
    doc = w("documentation.html")
    assert "/*__BUNDLE__*/null" in doc and "/*__ENGINE__*/" in doc and "/*__DOCS__*/" in doc
    write("documentation.html", doc.replace("/*__BUNDLE__*/null", bundle)
          .replace("/*__ENGINE__*/", app[a:b]).replace("/*__DOCS__*/", w("documentation.js")))


if __name__ == "__main__":
    main()
