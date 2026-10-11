"""One assistant per Home Assistant installation."""

from homeassistant import config_entries


class AlfredConfigFlow(config_entries.ConfigFlow, domain="alfred"):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id("alfred-reminders")
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Alfred", data={})
        return self.async_show_form(step_id="user")
