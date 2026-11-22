"""Add to the existing company runtime MRO, never instantiate a second runtime."""
class ProfileSelection(dict):
    def clear(self):
        profile = self.get('agentProfile')
        super().clear()
        if profile is not None:
            self['agentProfile'] = profile


class AgentProfileRuntimeMixin:
    def fence(self, session, ctx, selection):
        result = super().fence(session, ctx, selection)
        snapshot = selection.get('agentProfile')
        if snapshot is not None:
            current = self.agent_profiles.read(ctx.actor_id, ctx.company_id, ctx.bot_id)
            if current['revision'] != snapshot['revision']:
                from company_messaging.authority import Denied
                raise Denied(409, 'AGENT_PROFILE_CHANGED')
        return result

    async def _run(self, session, ctx, selection, turn, prompt, history):
        try:
            profile = self.agent_profiles.read(ctx.actor_id, ctx.company_id, ctx.bot_id)
        except Exception:
            # Match the existing runtime's private failure cleanup; no new output.
            with self.store.db() as db:
                self._set_state(db, turn, 'FAILED', 'AGENT_PROFILE_UNAVAILABLE')
            return
        selected = ProfileSelection(selection, agentProfile={k: profile[k] for k in ('botId', 'companyId', 'revision', 'name', 'purpose', 'instructions', 'configured')})
        if turn in getattr(self, 'scopes', {}):
            self.scopes[turn] = (session, ctx, selected)
        return await super()._run(session, ctx, selected, turn, prompt, history)

