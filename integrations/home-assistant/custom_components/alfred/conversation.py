"""Expose the same Alfred tools to HA Assist and its Apple entry points.

Personal mail and memories make this an administrator-only conversation agent.
Do not silently grant household satellites access to the owner's private data.
"""

from homeassistant.components import conversation
from homeassistant.components.conversation import (
    ChatLog,
    ConversationEntity,
    ConversationEntityFeature,
    AssistantContent,
)
from homeassistant.helpers import intent


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([AlfredConversation(entry)])


class AlfredConversation(ConversationEntity):
    _attr_name = "Alfred"
    _attr_icon = "alfred:butler"
    _attr_supported_features = ConversationEntityFeature.CONTROL

    def __init__(self, entry):
        self._attr_unique_id = entry.entry_id + "-conversation"

    @property
    def supported_languages(self):
        return ["en"]

    async def _async_handle_message(self, user_input, chat_log: ChatLog):
        r = self.hass.data["alfred"].runtime
        user_id = user_input.context.user_id
        user = await self.hass.auth.async_get_user(user_id) if user_id else None
        response = intent.IntentResponse(language=user_input.language)
        if not r.config.get("assistEnabled"):
            text = "Enable HA Assist access in Alfred → Connections."
        elif not user or not user.is_admin:
            text = "Alfred's personal services require an authenticated HA administrator. Use the paired Alfred phone page or glasses."
        else:
            try:
                data = await r.client("ask", {"text": user_input.text}, "ha:" + user_id)
                text = data["reply"]
            except Exception as e:
                text = str(e)[:500]
        chat_log.async_add_assistant_content_without_tools(
            AssistantContent(agent_id=user_input.agent_id, content=text)
        )
        response.async_set_speech(text)
        return conversation.ConversationResult(
            response=response,
            conversation_id=user_input.conversation_id,
            continue_conversation=bool(user and r.pending.get("ha:" + user_id)),
        )
