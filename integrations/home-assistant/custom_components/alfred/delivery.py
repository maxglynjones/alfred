"""Self-delivery and single-page response sizing, independent of any AI provider."""

import hashlib
import re
from datetime import datetime, timezone
from uuid import uuid4
from .local_ops import research
from .commands import capability_question


def display_lines(text):
    """Match the native reply layout: 504px wrapping, six lines per page."""

    def width(s):
        return sum(
            (
                6
                if c.isspace() or c in "ilI.,'!:;|"
                else 20 if c in "MW@%&#QO" else 24 if ord(c) > 0x2FF else 12
            )
            for c in s
        )

    count = 0
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = (line + " " + word).strip()
            if width(candidate) <= 504:
                line = candidate
            else:
                if line:
                    count += 1
                line = ""
                for char in word:
                    if width(line + char) > 504:
                        count += 1
                        line = ""
                    line += char
        count += 1
    return count


def lens_text(text):
    text = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    lines = text.splitlines()
    return "\n".join(
        line for i, line in enumerate(lines) if not i or line != lines[i - 1]
    ).strip()


class Delivery:
    def __init__(self, runtime):
        self.r = runtime

    async def finish(self, question, reply, presentation, device):
        # Presentation cleanup is independent of delivery: citations remain in reports/history.
        if "Sorry, could you repeat that?" in reply:
            reply = "Sorry, could you repeat that?"
        # Never mail an action preview, failure, or private pending confirmation.
        if (
            presentation != "conversation"
            or self.r.pending.get(device)
            or self.r.request_route.get(device) == "cloud_blocked"
        ):
            return reply, presentation
        # Product help is an on-display answer, never an unsolicited overflow email.
        if capability_question(question):
            return lens_text(reply), presentation
        # Routine views stay on the glasses. Reading a list or an existing email
        # is not an instruction to create another email, even if it spans pages.
        if re.fullmatch(
            r"(?:dashboard[., ]*)?(?:please )?(?:show|open)(?: me)?(?: my| the)? dashboard[.! ]*",
            question.strip(),
            re.I,
        ):
            return lens_text(reply), presentation
        routine_view = bool(
            re.search(
                r"\b(dashboard|shopping list|to[ -]?do(?: list)?|agenda|calendar|unread emails|inbox|reminders|memories|news|headlines)\b",
                question,
                re.I,
            )
            and re.match(
                r"(?:show|read|list|what|my|a |this is)\b", question.strip(), re.I
            )
        ) or bool(
            re.fullmatch(
                r"(?:read|open)(?: email)? (?:the )?(?:first|second|third|\d+)(?: one| email)?[.!?]*",
                question.strip(),
                re.I,
            )
        )
        if (
            routine_view
            and not research(question)
            and not re.search(r"\b(?:email|send|mail) (?:me|myself)\b", question, re.I)
        ):
            return lens_text(reply), presentation
        if not (
            research(question)
            or (self.r.config.get("emailOverflow", True) and display_lines(reply) > 6)
        ):
            return lens_text(reply), presentation
        delivered, mode = await self.send(question, reply, device)
        return lens_text(delivered), mode

    async def send(self, question, content, device, force=False):
        r = self.r
        recipient = r.profile().get("selfEmail", "")
        if not recipient or r.config.get("mailProvider") not in ("google", "outlook"):
            return (
                content
                + "\n\nTo email this result, set your self-email in Profile and connect a sending account in Connections.",
                "conversation",
            )
        if len(content) > 24000:
            return (
                content
                + "\n\nThis result exceeds the supported email size. It has not been sent.",
                "conversation",
            )
        key = hashlib.sha256((device + recipient + content).encode()).hexdigest()
        now = datetime.now(timezone.utc).timestamp()
        rows = r.data.setdefault("deliveries", [])
        previous = next(
            (x for x in reversed(rows) if x["key"] == key and now - x["at"] < 120), None
        )
        if previous:
            if previous["status"] == "accepted":
                return (
                    "The full response was already accepted by your email provider. Check your inbox.",
                    "conversation",
                )
            return (
                content
                + "\n\nPrevious email delivery is uncertain. Check Sent mail before requesting another copy.",
                "conversation",
            )
        receipt = {
            "id": str(uuid4()),
            "key": key,
            "at": now,
            "status": "sending",
            "kind": "email_result",
            "device": device,
            "target": "self",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        rows.append(receipt)
        self.r.data.setdefault("actions", []).append(receipt)
        del self.r.data["actions"][:-100]
        del rows[:-100]
        await r.save()  # Claim before the external write; do not duplicate after a timeout.
        try:
            result = await r.providers.send(
                {
                    "to": recipient,
                    "subject": "Alfred · " + re.sub(r"[\r\n]+", " ", question)[:120],
                    "body": content,
                }
            )
            if not result.get("accepted"):
                raise ValueError("The email provider did not accept the response.")
            receipt["status"] = "accepted"
            return (
                "Your email provider accepted the full response. Check your inbox.",
                "conversation",
            )
        except Exception:
            receipt["status"] = "uncertain"
            return (
                content
                + "\n\nEmail delivery failed or is uncertain. Check Connections and Sent mail; I have kept the answer here.",
                "conversation",
            )
        finally:
            if receipt["status"] == "sending":
                receipt["status"] = "uncertain"
            await r.save()
