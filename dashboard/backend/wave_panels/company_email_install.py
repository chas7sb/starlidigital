"""Minimal additions to the existing single-instance company_install factory."""
from email_runtime import EmailRuntimeMixin,bind_email_message_projection
from email_native_adapter import bind_email_native_adapter

def email_runtime_type(memory_tools_mixin,computer_runtime_class):
 # Caller supplies the already joined trusted classes; no imports from tool/model data.
 class JoinedCompanyRuntime(EmailRuntimeMixin,memory_tools_mixin,computer_runtime_class):pass
 return JoinedCompanyRuntime

def email_constructor_kwargs(email_rpc):
 draft,review=bind_email_native_adapter(email_rpc)
 return dict(email_draft=draft,email_review=review)

def finish_email_install(runtime):
 if not isinstance(runtime,EmailRuntimeMixin):raise TypeError('Email mixin must be in the single runtime MRO')
 if not callable(runtime.email_draft) or not callable(runtime.email_review):raise TypeError('Trusted email callbacks required')
 bind_email_message_projection(runtime.store,runtime)
 return runtime

def set_email_callbacks_before_start(runtime,email_rpc):
 """Alternative when constructor args cannot change; use before lifespan/startup only."""
 if not isinstance(runtime,EmailRuntimeMixin) or getattr(runtime,'tasks',{}):raise ValueError('Email callback binding requires an idle joined runtime')
 runtime.email_draft,runtime.email_review=bind_email_native_adapter(email_rpc)
 return finish_email_install(runtime)
