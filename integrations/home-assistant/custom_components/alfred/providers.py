"""Bounded provider adapters. Credentials stay server-side and are not returned to client views."""

import asyncio
import base64
import hashlib
import io
import ipaddress
import json
import secrets
import socket
import struct
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import parseaddr
from urllib.parse import urlencode, quote, urlparse
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo
import aiohttp
from .calendar_rules import spec, google_rule, graph_rule, next_event
from .weather import WeatherProvider
from .email_format import email_html, plain_text, logo_bytes, LOGO_ID


class PublicResolver(aiohttp.abc.AbstractResolver):
    """Validate and pin all resolved feed addresses to the socket connection."""

    async def resolve(self, host, port=0, family=socket.AF_INET):
        values = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM
        )
        result = []
        for fam, _, _, _, address in values:
            ip = address[0]
            if not ipaddress.ip_address(ip).is_global:
                raise ValueError("News feed resolves to a private or reserved address.")
            result.append(
                {
                    "hostname": host,
                    "host": ip,
                    "port": port,
                    "family": fam,
                    "proto": 0,
                    "flags": socket.AI_NUMERICHOST,
                }
            )
        if not result:
            raise ValueError("News source could not be resolved.")
        return result

    async def close(self):
        pass


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def plain_mime(to, subject, body, attachment=None):
    if any(c in to + subject for c in "\r\n"):
        raise ValueError("Use a single recipient and subject line.")
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    logo = logo_bytes()
    msg.set_content(plain_text(body))
    msg.add_alternative(email_html(subject, body, bool(logo)), subtype="html")
    if logo:
        msg.get_payload()[-1].add_related(
            logo,
            maintype="image",
            subtype="png",
            cid=f"<{LOGO_ID}>",
            disposition="inline",
            filename="alfred.png",
        )
    if attachment:
        msg.add_attachment(
            attachment["bytes"],
            maintype=attachment["mime"].split("/")[0],
            subtype=attachment["mime"].split("/")[1],
            filename=attachment["name"],
        )
    return b64(msg.as_bytes())


def document(title, content, format):
    """Small bounded document generation runs in HA's executor, never its event loop."""
    if format in ("email", "body", None):
        return None
    if format in ("txt", "text", "md", "markdown"):
        return {
            "name": "alfred-report."
            + ("md" if format in ("md", "markdown") else "txt"),
            "mime": "text/plain",
            "bytes": content.encode(),
        }
    if format in ("docx", "word"):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(
                "[Content_Types].xml",
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            )
            z.writestr(
                "_rels/.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            )
            z.writestr(
                "word/document.xml",
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                + "".join(
                    '<w:p><w:r><w:t xml:space="preserve">'
                    + escape(line)
                    + "</w:t></w:r></w:p>"
                    for line in (title + "\n" + content).splitlines()
                )
                + "</w:body></w:document>",
            )
        return {
            "name": "alfred-report.docx",
            "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "bytes": output.getvalue(),
        }
    if format == "pdf":
        import textwrap

        lines = [
            part
            for line in (title + "\n\n" + content).splitlines()
            for part in (textwrap.wrap(line, 90) or [""])
        ]
        pages = [lines[i : i + 48] for i in range(0, len(lines), 48)] or [[]]
        objects = [b"", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
        kids = []
        for lines in pages:
            page_id = len(objects) + 1
            stream_id = page_id + 1
            kids.append(f"{page_id} 0 R")
            stream = (
                "BT /F1 10 Tf 50 790 Td 14 TL "
                + "".join(
                    "("
                    + line.encode("cp1252", "replace")
                    .decode("cp1252")
                    .replace("\\", "\\\\")
                    .replace("(", "\\(")
                    .replace(")", "\\)")
                    + ") Tj T* "
                    for line in lines
                )
                + "ET"
            )
            raw = stream.encode("cp1252")
            objects.extend(
                [
                    f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>".encode(),
                    b"<< /Length "
                    + str(len(raw)).encode()
                    + b" >>\nstream\n"
                    + raw
                    + b"\nendstream",
                ]
            )
        objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
        objects[1] = (
            f'<< /Type /Pages /Count {len(pages)} /Kids [{" ".join(kids)}] >>'.encode()
        )
        out = b"%PDF-1.4\n"
        offsets = [0]
        for i, obj in enumerate(objects, 1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
        xref = len(out)
        out += (
            f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode()
            + b"".join(f"{n:010d} 00000 n \n".encode() for n in offsets[1:])
            + f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
        )
        return {"name": "alfred-report.pdf", "mime": "application/pdf", "bytes": out}
    raise ValueError("Choose email, text, Markdown, PDF or Word.")


class Providers(WeatherProvider):
    def __init__(self, r):
        self.r = r
        self.tokens = {}
        self.oauth = {}
        self.cache = {}
        self.refresh_lock = asyncio.Lock()

    def ready(self):
        c = self.r.config
        p = c.get("replyProvider", "none")
        return bool(
            (p == "openai" and c.get("apiKey") and c.get("replyModel"))
            or (p == "claude" and c.get("claudeKey") and c.get("claudeModel"))
            or (p == "ollama" and c.get("ollamaUrl") and c.get("ollamaModel"))
        )

    def selected(self, kind, requested=None):
        """Explicit provider choices win; otherwise prefer the configured connected default."""
        if requested in ("google", "outlook"):
            return requested
        preferred = self.r.config.get(kind + "Provider", "none")
        connected = [
            p
            for p in ("google", "outlook")
            if self.r.config.get(p, {}).get("refreshToken")
        ]
        return (
            preferred
            if preferred in connected
            else connected[0] if len(connected) == 1 else preferred
        )

    def connected(self, kind):
        return bool(self.r.config.get(self.selected(kind), {}).get("refreshToken"))

    async def transcribe(self, pcm):
        if len(pcm) < 3200 or len(pcm) > 960000 or len(pcm) % 2:
            raise ValueError("Speak for between 0.1 and 30 seconds.")
        c = self.r.config
        provider = c.get("transcriptionProvider")
        if provider == "ha":
            from .media import transcribe_ha

            return await transcribe_ha(self.r, pcm)
        if provider not in ("openai", "local"):
            raise ValueError("Choose speech recognition in HA → Alfred → Connections.")
        header = (
            b"RIFF"
            + struct.pack("<I", 36 + len(pcm))
            + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)
            + b"data"
            + struct.pack("<I", len(pcm))
        )
        form = aiohttp.FormData()
        form.add_field(
            "file", header + pcm, filename="voice.wav", content_type="audio/wav"
        )
        form.add_field("model", c.get("transcriptionModel") or "whisper-1")
        # Short English utterances can otherwise be mistaken for another language.
        language = c.get("transcriptionLanguage") or "en"
        form.add_field(
            (
                "languages[]"
                if provider == "openai"
                and c.get("transcriptionModel") == "gpt-transcribe"
                else "language"
            ),
            language,
        )
        if provider == "openai" and language == "en":
            form.add_field(
                "prompt",
                "Alfred. Kitchen lights. Bedroom lights. Bathroom lights. Shopping list. To-do list. Calendar. Ask AI.",
            )
        url = (
            "https://api.openai.com/v1/audio/transcriptions"
            if provider == "openai"
            else c.get("localSpeechUrl", "") + "/v1/audio/transcriptions"
        )
        if provider == "openai" and not c.get("apiKey"):
            raise ValueError("Configure an OpenAI key for speech.")
        d = await self.r.http(
            "POST",
            url,
            headers=(
                {"Authorization": "Bearer " + c["apiKey"]}
                if provider == "openai"
                else None
            ),
            form=form,
            timeout=10,
        )
        return d.get("text", "").strip()

    async def token(self, p):
        async with self.refresh_lock:
            cached = self.tokens.get(p)
            if cached and cached["expires"] > time.monotonic():
                return cached["token"]
            c = self.r.config.get(p, {})
            if not c.get("refreshToken"):
                raise ValueError(f"Connect {p} in HA → Alfred → Connections.")
            body = {
                "client_id": c["clientId"],
                "refresh_token": c["refreshToken"],
                "grant_type": "refresh_token",
            }
            if c.get("clientSecret"):
                body["client_secret"] = c["clientSecret"]
            if p == "outlook":
                body["scope"] = " ".join(c.get("scopes", []))
                url = (
                    "https://login.microsoftonline.com/"
                    + quote(c.get("tenant", "common"), safe="")
                    + "/oauth2/v2.0/token"
                )
            else:
                url = "https://oauth2.googleapis.com/token"
            d = await self.r.http("POST", url, form=body)
            if not d.get("access_token"):
                raise ValueError(f"Reconnect {p}; no access token was returned.")
            if d.get("refresh_token"):
                c["refreshToken"] = d["refresh_token"]
                await self.r.save()
            self.tokens[p] = {
                "token": d["access_token"],
                "expires": time.monotonic() + min(d.get("expires_in", 3600), 3600) - 60,
            }
            return d["access_token"]

    async def request(self, p, path, method="GET", body=None):
        if not isinstance(path, str) or path.startswith(("http:", "https:", "//")):
            raise ValueError("Invalid provider path.")
        base = (
            "https://www.googleapis.com/"
            if p == "google"
            else "https://graph.microsoft.com/v1.0/"
        )
        return await self.r.http(
            method,
            base + path,
            headers={
                "Authorization": "Bearer " + await self.token(p),
                **({"Prefer": 'outlook.timezone="UTC"'} if p == "outlook" else {}),
            },
            body=body,
        )

    def require_scope(self, p, scope):
        scopes = self.r.config.get(p, {}).get("scopes", [])
        if not any(scope.lower() in x.lower() for x in scopes):
            raise ValueError(f"Reconnect {p} and approve {scope} in Connections.")

    async def search_mail(self, a, p=None):
        p = self.selected("mail", p)
        query = a.get("query", "")
        limit = min(int(a.get("limit", a.get("max_results", 10))), 20)
        if p == "google":
            d = await self.request(
                p,
                "gmail/v1/users/me/messages?"
                + urlencode(
                    {
                        "q": query,
                        "maxResults": limit,
                        **(
                            {"pageToken": a["page_token"]}
                            if a.get("page_token")
                            else {}
                        ),
                    }
                ),
            )
            rows = []
            for m in d.get("messages", []):
                rows.append(
                    await self.read_mail({"message_id": m["id"]}, p, metadata=True)
                )
            return {
                "messages": rows,
                "more_available": bool(d.get("nextPageToken")),
                "next_page_token": d.get("nextPageToken"),
            }
        if p == "outlook":
            d = await self.request(
                p,
                "me/messages?"
                + urlencode(
                    {
                        "$search": '"' + query.replace('"', "") + '"',
                        "$top": limit,
                        "$select": "id,subject,from,receivedDateTime,bodyPreview",
                    }
                ),
            )
            return {
                "messages": d.get("value", []),
                "more_available": "@odata.nextLink" in d,
            }
        raise ValueError("Choose a connected mail provider.")

    async def read_mail(self, a, p=None, metadata=False):
        p = self.selected("mail", p)
        id = quote(a.get("message_id", a.get("id", "")), safe="")
        if not id:
            raise ValueError("Search email first and use its current message ID.")
        if p == "outlook":
            return await self.request(p, "me/messages/" + id)
        d = await self.request(p, "gmail/v1/users/me/messages/" + id + "?format=full")
        headers = {
            h["name"].lower(): h["value"]
            for h in d.get("payload", {}).get("headers", [])
        }

        def text(part):
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get(
                "data"
            ):
                raw = part["body"]["data"]
                return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode(
                    "utf-8", "replace"
                )
            return "\n".join(text(x) for x in part.get("parts", []))

        return {
            "id": d["id"],
            "subject": headers.get("subject", ""),
            "from": headers.get("from", ""),
            "reply_to": headers.get("reply-to", headers.get("from", "")),
            "snippet": d.get("snippet", ""),
            "body": text(d.get("payload", {}))[:12000] if not metadata else "",
            "headers": headers,
            "payload": d.get("payload", {}),
        }

    async def events(self, a, p=None):
        p = self.selected("calendar", p)
        zone = ZoneInfo(self.r.profile().get("timezone", "UTC"))
        now = datetime.now(zone)
        start = a.get(
            "time_min",
            a.get(
                "start",
                now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
            ),
        )
        end = a.get(
            "time_max",
            a.get(
                "end",
                (
                    now.replace(hour=0, minute=0, second=0, microsecond=0)
                    + timedelta(days=1)
                ).isoformat(),
            ),
        )
        if p == "google":
            id = quote(a.get("calendar_id", "primary"), safe="")
            d = await self.request(
                p,
                "calendar/v3/calendars/"
                + id
                + "/events?"
                + urlencode(
                    {
                        "timeMin": start,
                        "timeMax": end,
                        "singleEvents": "true",
                        "orderBy": "startTime",
                        "maxResults": 100,
                        **(
                            {"pageToken": a["page_token"]}
                            if a.get("page_token")
                            else {}
                        ),
                    }
                ),
            )
            return {
                "events": [
                    {
                        "id": x["id"],
                        "title": x.get("summary", ""),
                        "start": x["start"],
                        "end": x["end"],
                        "location": x.get("location", ""),
                        "recurring": bool(x.get("recurringEventId")),
                        "attendees": x.get("attendees", []),
                    }
                    for x in d.get("items", [])
                ],
                "more_available": bool(d.get("nextPageToken")),
                "next_page_token": d.get("nextPageToken"),
            }
        if p == "outlook":
            d = await self.request(
                p,
                "me/calendarView?"
                + urlencode(
                    {
                        "startDateTime": start,
                        "endDateTime": end,
                        "$top": 100,
                        "$orderby": "start/dateTime",
                    }
                ),
            )
            return {
                "events": [
                    {
                        "id": x["id"],
                        "title": x["subject"],
                        "start": {
                            **x["start"],
                            "dateTime": (
                                x["start"]["dateTime"] + "Z"
                                if not x["start"]["dateTime"].endswith("Z")
                                else x["start"]["dateTime"]
                            ),
                        },
                        "end": {
                            **x["end"],
                            "dateTime": (
                                x["end"]["dateTime"] + "Z"
                                if not x["end"]["dateTime"].endswith("Z")
                                else x["end"]["dateTime"]
                            ),
                        },
                        "isAllDay": x.get("isAllDay"),
                        "attendees": x.get("attendees", []),
                        "recurring": x.get("type") != "singleInstance",
                    }
                    for x in d.get("value", [])
                ],
                "more_available": "@odata.nextLink" in d,
            }
        raise ValueError("Connect your preferred calendar in HA → Alfred.")

    async def send(self, a, p=None, draft=False):
        p = self.selected("mail", p)
        to = parseaddr(a.get("to", ""))[1]
        if not to or "@" not in to or "\n" in to or len(a.get("body", "")) > 24000:
            raise ValueError("Use one valid recipient and a bounded message.")
        attachment = await self.r.hass.async_add_executor_job(
            document,
            a.get("subject", "Alfred report"),
            a.get("attachment_content", a.get("body", "")),
            a.get("format"),
        )
        if p == "google":
            self.require_scope(p, "gmail.compose" if draft else "gmail.send")
            message = {"raw": plain_mime(to, a["subject"], a["body"], attachment)}
            d = await self.request(
                p,
                (
                    "gmail/v1/users/me/drafts"
                    if draft
                    else "gmail/v1/users/me/messages/send"
                ),
                "POST",
                {"message": message} if draft else message,
            )
        elif p == "outlook":
            self.require_scope(p, "Mail.ReadWrite" if draft else "Mail.Send")
            message = {
                "subject": a["subject"],
                "body": {
                    "contentType": "HTML",
                    "content": email_html(a["subject"], a["body"], bool(logo_bytes())),
                },
                "toRecipients": [{"emailAddress": {"address": to}}],
            }
            if attachment:
                message["attachments"] = [
                    {
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": attachment["name"],
                        "contentType": attachment["mime"],
                        "contentBytes": base64.b64encode(attachment["bytes"]).decode(),
                    }
                ]
            logo = logo_bytes()
            if logo:
                message.setdefault("attachments", []).append(
                    {
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": "alfred.png",
                        "contentType": "image/png",
                        "isInline": True,
                        "contentId": LOGO_ID,
                        "contentBytes": base64.b64encode(logo).decode(),
                    }
                )
            d = await self.request(
                p,
                "me/messages" if draft else "me/sendMail",
                "POST",
                message if draft else {"message": message, "saveToSentItems": True},
            )
        else:
            raise ValueError("Choose a mail provider.")
        return {
            "accepted": True,
            "sent": not draft,
            "draft": draft,
            "id": d.get("id") if isinstance(d, dict) else None,
        }

    async def event_write(self, a, p=None, operation="create"):
        p = self.selected("calendar", p)
        id = quote(a.get("event_id", ""), safe="")
        base = "calendar/v3/calendars/primary/events" if p == "google" else "me/events"
        self.require_scope(
            p, "calendar.events" if p == "google" else "Calendars.ReadWrite"
        )
        if operation != "create":
            current = await self.request(p, base + "/" + id)
            if (
                current.get("attendees")
                or current.get("recurrence")
                or current.get("recurringEventId")
                or current.get("type", "singleInstance") != "singleInstance"
            ):
                raise ValueError("Editing shared or recurring events is not supported.")
        if operation == "delete":
            await self.request(p, base + "/" + id, "DELETE")
            return {
                "accepted": True,
                "deleted": True,
                "verified": True,
                "verification_basis": "provider acknowledged DELETE",
            }
        schedule = (
            spec(a, self.r.profile().get("timezone", "UTC"))
            if operation == "create"
            else None
        )
        body = {
            "summary" if p == "google" else "subject": a.get("title", a.get("summary"))
        }
        for key in ("start", "end"):
            value = a.get(key, a.get(key + "_time"))
            if value:
                body[key] = {
                    "dateTime": value,
                    **(
                        {"timeZone": self.r.profile().get("timezone", "UTC")}
                        if p == "outlook"
                        or (schedule and schedule["frequency"] != "none")
                        else {}
                    ),
                }
        if a.get("all_day"):
            for k in ("start", "end"):
                if p == "google":
                    body[k] = {"date": a[k][:10]}
            if p == "outlook":
                body["isAllDay"] = True
        if a.get("guests"):
            body["attendees"] = (
                [{"email": email} for email in a["guests"]]
                if p == "google"
                else [
                    {"emailAddress": {"address": email}, "type": "required"}
                    for email in a["guests"]
                ]
            )
        if schedule:
            if p == "outlook":
                for key in ("start", "end"):
                    body[key] = {
                        "dateTime": datetime.fromisoformat(schedule[key])
                        .replace(tzinfo=None)
                        .isoformat(),
                        "timeZone": schedule["timezone"],
                    }
            recurrence = (
                google_rule(schedule) if p == "google" else graph_rule(schedule)
            )
            if recurrence:
                body["recurrence"] = recurrence
            minutes, delivery = (
                schedule["reminder_minutes"],
                schedule["reminder_delivery"],
            )
            if minutes is not None:
                if p == "google":
                    body["reminders"] = {
                        "useDefault": False,
                        "overrides": (
                            [{"method": "popup", "minutes": minutes}]
                            if delivery in ("calendar", "both")
                            else []
                        ),
                    }
                else:
                    body["isReminderOn"] = delivery in ("calendar", "both")
                    body["reminderMinutesBeforeStart"] = minutes
        if a.get("location"):
            body["location"] = (
                a["location"] if p == "google" else {"displayName": a["location"]}
            )
        body = {k: v for k, v in body.items() if v is not None}
        d = await self.request(
            p,
            base + ("/" + id if operation == "update" else ""),
            "PATCH" if operation == "update" else "POST",
            body,
        )
        # Read after creating; never retry the write when the response is uncertain.
        verified = False
        if isinstance(d, dict) and d.get("id"):
            try:
                observed = await self.request(p, base + "/" + quote(d["id"], safe=""))
                verified = observed.get("id") == d["id"] and observed.get(
                    "summary" if p == "google" else "subject"
                ) == body.get("summary" if p == "google" else "subject")
                if schedule:
                    for key in ("start", "end"):
                        seen = observed.get(key, {})
                        if p == "google" and schedule["all_day"]:
                            verified = verified and seen.get("date") == a[key]
                        else:
                            value = datetime.fromisoformat(
                                seen.get("dateTime", "").replace("Z", "+00:00")
                            )
                            if value.tzinfo is None:
                                value = value.replace(
                                    tzinfo=ZoneInfo(seen.get("timeZone", "UTC"))
                                )
                            verified = verified and value.astimezone(
                                timezone.utc
                            ) == datetime.fromisoformat(schedule[key]).astimezone(
                                timezone.utc
                            )
                    if schedule["frequency"] != "none":
                        expected, actual = body.get("recurrence"), observed.get(
                            "recurrence"
                        )
                        if p == "outlook" and isinstance(actual, dict):
                            verified = verified and all(
                                all(
                                    actual.get(section, {}).get(k) == v
                                    for k, v in values.items()
                                )
                                for section, values in expected.items()
                            )
                        else:
                            verified = verified and actual == expected
                    if schedule["reminder_minutes"] is not None:
                        keys = (
                            ("reminders",)
                            if p == "google"
                            else ("isReminderOn", "reminderMinutesBeforeStart")
                        )
                        verified = verified and all(
                            observed.get(k) == body.get(k) for k in keys
                        )
            except (ValueError, KeyError, TypeError):
                verified = False
        result = {"accepted": True, "verified": verified, "event": d}
        if schedule and schedule["reminder_delivery"] in ("ha", "both"):
            if not verified:
                result["notification_error"] = (
                    "The calendar write is unverified; no HA reminder was scheduled. Check your calendar before repeating."
                )
            else:
                offset = timedelta(minutes=schedule["reminder_minutes"])
                occurrence = next_event(schedule, datetime.now(timezone.utc) + offset)
                if occurrence:
                    try:
                        reminder = await self.r.engine.execute(
                            "create_reminder",
                            {
                                "title": a["title"],
                                "due_at": (occurrence - offset).isoformat(),
                                "calendar_schedule": schedule,
                                "source_key": p + ":" + d["id"],
                            },
                        )
                        result["ha_reminder"] = reminder.get("item", {})
                    except (ValueError, TypeError, KeyError) as exc:
                        result["notification_error"] = (
                            "Calendar saved, but HA notification setup failed: "
                            + str(exc)
                        )
                else:
                    result["notification_error"] = (
                        "Calendar saved; no future notification occurrence remains."
                    )
        return result

    async def news(self, a):
        if self.r.config.get("newsBackend") == "ha":
            return await self.r.engine.execute("list_feedreader_news", a)
        sources = [
            x
            for x in self.r.config.get("newsSources", [])
            if x.get("enabled", True)
            and (
                a.get("source", "all") == "all"
                or a.get("source", "").casefold() in x["name"].casefold()
            )
        ]
        if not sources:
            raise ValueError("Choose news feeds in HA → Alfred → News.")

        async def feed(source):
            cached = self.cache.get(("news", source["url"]))
            if cached and cached[0] > time.monotonic():
                return cached[1]
            u = urlparse(source["url"])
            if (
                u.scheme != "https"
                or u.username
                or u.password
                or u.port not in (None, 443)
            ):
                raise ValueError("Use public HTTPS feed addresses.")
            connector = aiohttp.TCPConnector(resolver=PublicResolver())
            async with asyncio.timeout(5):
                async with aiohttp.ClientSession(connector=connector) as session:
                    async with session.get(
                        source["url"], allow_redirects=False
                    ) as resp:
                        if resp.status != 200:
                            raise ValueError("Feed is unavailable.")
                        raw = await resp.content.read(524289)
            if (
                len(raw) > 524288
                or b"<!DOCTYPE" in raw.upper()
                or b"<!ENTITY" in raw.upper()
            ):
                raise ValueError("Feed exceeds limits or includes unsupported XML.")
            rows = await self.r.hass.async_add_executor_job(parse_feed, raw, source)
            self.cache[("news", source["url"])] = (time.monotonic() + 900, rows)
            return rows

        results = await asyncio.gather(
            *(feed(x) for x in sources[:12]), return_exceptions=True
        )
        rows = []
        errors = []
        for source, result in zip(sources, results):
            if isinstance(result, BaseException):
                errors.append({"source": source["name"], "error": str(result)})
            else:
                rows.extend(result)
        return {
            "items": rows[: min(int(a.get("count", 5)), 40)],
            "sources": sources,
            "errors": errors,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    async def search(self, a):
        c = self.r.config
        p = c.get("webSearchProvider", "none")
        q = a.get("query", "")
        if not q or len(q) > 1000:
            raise ValueError("Use a bounded public research question.")
        if p == "openai":
            if not c.get("apiKey") or not c.get("webSearchModel"):
                raise ValueError(
                    "Choose an OpenAI web-search model and key in Connections."
                )
            d = await self.r.http(
                "POST",
                "https://api.openai.com/v1/responses",
                headers={"Authorization": "Bearer " + c["apiKey"]},
                body={
                    "model": c["webSearchModel"],
                    "store": False,
                    "tools": [{"type": "web_search"}],
                    "input": "Research this public question. Cite sources with URLs and distinguish facts from uncertainty: "
                    + q,
                    "max_output_tokens": 2500,
                },
                timeout=15,
            )
            text = ""
            sources = []
            for item in d.get("output", []):
                for part in item.get("content", []):
                    text += part.get("text", "")
                    for link in part.get("annotations", []):
                        if link.get("type") == "url_citation":
                            sources.append(
                                {"title": link.get("title", ""), "url": link["url"]}
                            )
            if not sources:
                raise ValueError(
                    "Search returned no verified citations; no research report was prepared."
                )
            return {
                "summary": text,
                "sources": sources,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
            }
        raise ValueError(
            "Choose web search in HA → Alfred → Connections. News feeds are configured separately."
        )

    async def oauth_start(self, p, origin):
        c = self.r.config.get(p, {})
        if not c.get("clientId"):
            raise ValueError("Configure your OAuth client first.")
        verifier = secrets.token_urlsafe(48)
        state = secrets.token_urlsafe(32)
        callback = origin + "/alfred/oauth/" + p
        self.oauth[state] = {
            "provider": p,
            "verifier": verifier,
            "expires": time.monotonic() + 300,
            "callback": callback,
        }
        scopes = (
            [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.send",
                "https://www.googleapis.com/auth/gmail.compose",
                "https://www.googleapis.com/auth/calendar.events",
            ]
            if p == "google"
            else [
                "offline_access",
                "User.Read",
                "Mail.Read",
                "Mail.Send",
                "Mail.ReadWrite",
                "Calendars.ReadWrite",
            ]
        )
        self.oauth[state]["scopes"] = scopes
        url = (
            "https://accounts.google.com/o/oauth2/v2/auth"
            if p == "google"
            else "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        )
        return {
            "url": url
            + "?"
            + urlencode(
                {
                    "client_id": c["clientId"],
                    "redirect_uri": callback,
                    "response_type": "code",
                    "scope": " ".join(scopes),
                    "state": state,
                    "code_challenge": b64(hashlib.sha256(verifier.encode()).digest()),
                    "code_challenge_method": "S256",
                    **(
                        {"access_type": "offline", "prompt": "consent"}
                        if p == "google"
                        else {}
                    ),
                }
            ),
            "callback": callback,
        }

    async def oauth_finish(self, p, a):
        state = self.oauth.pop(a.get("state", ""), None)
        if (
            not state
            or state["provider"] != p
            or state["expires"] < time.monotonic()
            or not a.get("code")
        ):
            raise ValueError(
                "Google/Microsoft sign-in expired. Start again in HA → Alfred."
            )
        c = self.r.config[p]
        body = {
            "client_id": c["clientId"],
            "code": a["code"],
            "code_verifier": state["verifier"],
            "redirect_uri": state["callback"],
            "grant_type": "authorization_code",
        }
        if c.get("clientSecret"):
            body["client_secret"] = c["clientSecret"]
        d = await self.r.http(
            "POST",
            (
                "https://oauth2.googleapis.com/token"
                if p == "google"
                else "https://login.microsoftonline.com/common/oauth2/v2.0/token"
            ),
            form=body,
        )
        if not d.get("refresh_token"):
            raise ValueError("Offline access was not granted. Start sign-in again.")
        granted = d.get("scope", "").split()
        if not all(
            s in granted
            for s in state["scopes"]
            if s not in ("offline_access", "User.Read")
        ):
            raise ValueError("Required permissions were not granted.")
        c.update(refreshToken=d["refresh_token"], scopes=granted)
        self.tokens.pop(p, None)
        await self.r.save()


def parse_feed(raw, source):
    root = ET.fromstring(raw)
    rows = []
    for item in root.iter():
        if item.tag.split("}")[-1] not in ("item", "entry"):
            continue
        parts = {x.tag.split("}")[-1]: x for x in item}
        title = parts.get("title")
        link = parts.get("link")
        description = parts.get("description", parts.get("summary"))
        url = (link.text or link.attrib.get("href", "")) if link is not None else ""
        if title is None or urlparse(url).scheme not in ("http", "https"):
            continue
        rows.append(
            {
                "title": "".join(title.itertext())[:300],
                "url": url,
                "description": (
                    "".join(description.itertext())[:1000]
                    if description is not None
                    else ""
                ),
                "source": source["name"],
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if len(rows) >= 40:
            break
    return rows
