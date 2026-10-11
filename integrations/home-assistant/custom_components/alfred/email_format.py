"""Safe, portable email presentation with an embedded brand asset.

Provider content is always escaped. Only a small Markdown subset is rendered;
HTML from messages or model output is never trusted. No remote logo, font or
tracking pixel is loaded by the recipient's mail client.
"""

from html import escape
from functools import lru_cache
from pathlib import Path
import re
from urllib.parse import urlparse

LOGO_ID = "alfred-logo@local"


@lru_cache(maxsize=1)
def logo_bytes():
    """The build places the same butler asset in the HA and Even frontends."""
    path = Path(__file__).parent / "frontend/app/assets/alfred-icon-192.png"
    return path.read_bytes() if path.is_file() else None


def plain_text(content):
    """Keep sources readable in clients that prefer the plain-text alternative."""
    content = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r"\1 (\2)", content)
    content = re.sub(r"(?m)^#{1,6}\s+", "", content)
    content = re.sub(r"(?m)^\s*(?:-{3,}|\*{3,}|_{3,})\s*$", "", content)
    return re.sub(
        r"\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*", lambda m: m[1] or m[2], content
    )


def inline(content):
    """Render formatting only after escaping every supplied character."""
    safe = escape(content, quote=True)

    def link(match):
        label, url = match.groups()
        # Escaped quotes/ampersands remain escaped in the attribute.
        if urlparse(url).scheme not in ("https", "http"):
            return label
        return f'<a href="{url}" style="color:#237947;text-decoration:underline">{label}</a>'

    safe = re.sub(r"\[([^\]\n]+)\]\(([^\s)]+)\)", link, safe)
    safe = re.sub(r"\*\*\*([^*\n]+)\*\*\*", r"<strong><em>\1</em></strong>", safe)
    safe = re.sub(r"\*\*([^*\n]+)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", safe)
    safe = re.sub(
        r"`([^`\n]+)`",
        r'<code style="background:#edf4ef;padding:2px 4px;border-radius:3px">\1</code>',
        safe,
    )
    return safe


def body_html(content):
    parts, paragraph = [], []
    list_kind = None

    def flush():
        if paragraph:
            parts.append(
                '<p style="margin:0 0 16px;line-height:1.65">'
                + "<br>".join(inline(x) for x in paragraph)
                + "</p>"
            )
            paragraph.clear()

    def close_list():
        nonlocal list_kind
        if list_kind:
            parts.append(f"</{list_kind}>")
            list_kind = None

    for line in content.splitlines():
        heading = re.match(r"^#{1,6}\s+(.+)$", line)
        item = re.match(r"^\s*(?:[-*•]\s+|\d+[.)]\s+)(.+)$", line)
        if re.fullmatch(r"(?:-{3,}|\*{3,}|_{3,})", line.strip()):
            flush()
            close_list()
            parts.append(
                '<hr style="border:0;border-top:1px solid #dce8df;margin:22px 0">'
            )
        elif item:
            flush()
            kind = "ol" if re.match(r"^\s*\d", line) else "ul"
            if kind != list_kind:
                close_list()
                parts.append(
                    f'<{kind} style="padding-left:22px;margin:0 0 18px;line-height:1.7">'
                )
                list_kind = kind
            parts.append('<li style="margin-bottom:7px">' + inline(item[1]) + "</li>")
        else:
            close_list()
            if heading:
                flush()
                parts.append(
                    '<h2 style="font-size:19px;color:#133a26;margin:24px 0 12px">'
                    + inline(heading[1])
                    + "</h2>"
                )
            elif not line.strip():
                flush()
            else:
                paragraph.append(line)
    flush()
    close_list()
    return "".join(parts)


def email_html(subject, content, has_logo=True):
    logo = (
        f'<img src="cid:{LOGO_ID}" width="44" height="44" alt="Alfred" style="display:block;border-radius:12px">'
        if has_logo
        else ""
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#eef4f0;color:#25372c;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce8df;border-radius:16px">
<tr><td style="padding:24px 28px;background:#102b1c;border-radius:16px 16px 0 0"><table role="presentation"><tr><td>{logo}</td><td style="padding-left:14px;color:#d4f3df;font-size:24px;font-weight:600">Alfred<br><span style="font-size:11px;font-weight:400;letter-spacing:2px">AT YOUR SERVICE</span></td></tr></table></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:25px;line-height:1.3;margin:0 0 24px;color:#133a26">{escape(subject)}</h1>{body_html(content)}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #edf2ee;color:#6a7d70;font-size:12px;line-height:1.6">Prepared by your self-hosted Alfred assistant.<br>Manage your connections and delivery preferences in Home Assistant → Alfred.</td></tr>
</table></td></tr></table></body></html>"""
