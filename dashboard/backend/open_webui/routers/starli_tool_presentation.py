"""Human-readable catalog metadata only; never grants tool permissions."""
import re
LABELS={
"project_manage":"Create or update a project","projects_list":"Your projects","project_get":"Project details",
"project_files":"Project files","project_file_read":"Read project file","project_file_write":"Edit project file","project_preview":"Project preview",
"website_generate":"Build or improve website","website_get_structure":"Website structure",
"crm_search_prospects":"Find companies","crm_get_prospect":"Company details","crm_upsert_prospect":"Save company","crm_add_activity":"Add CRM note or task","crm_list_opportunities":"Sales pipeline",
"inbox_search":"Search mailbox","inbox_read":"Read message","outreach_create_draft":"Write email draft","outreach_get_thread":"Email conversation",
"video_project_create":"Create video","video_project_apply_spec":"Edit video composition","video_project_patch_spec":"Adjust video scene","video_render_start":"Render video","video_render_status":"Video progress","video_output_get":"Finished video","video_voiceover_create":"Generate voiceover",
"social_connection":"Connect social accounts","social_tools":"Social capabilities","social_read":"Social status and schedules","social_prepare":"Prepare social action","social_actions":"Social action receipts",
"starlis.list":"Your AI team","starlis.message":"Message an agent","delegate.task":"Delegate task","delegate.status":"Task progress","delegate.cancel":"Cancel task",
}
def present(tool):
    name=str(tool.get("name",""))
    label=LABELS.get(name) or re.sub(r"[_\.]+"," ",name).strip().capitalize()
    category=("Projects" if name.startswith(("project","website","templates")) else
              "CRM" if name.startswith(("crm_","company_","pipeline_","lead_")) else
              "Mailbox" if name.startswith(("inbox_","outreach_","mailbox_")) else
              "Social" if name.startswith(("social_","facebook_","instagram_")) else
              "Video & media" if name.startswith(("video_","brand_","asset")) else
              "AI team" if name.startswith(("agent_","starlis.","delegate.","task_")) else
              "Tools")
    return {**tool,"displayName":label,"category":category}
