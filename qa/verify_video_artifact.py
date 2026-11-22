"""Decode the actually downloaded synthetic MP4 and inspect actual PNG dimensions."""
import argparse,json,pathlib,struct,subprocess,shutil,secrets
from disposable_features import ROOT,helper,Failure
def main():
 p=argparse.ArgumentParser();p.add_argument("--artifact-dir",type=pathlib.Path,required=True);p.add_argument("--dashboard",action="store_true");a=p.parse_args();d=a.artifact_dir.resolve()
 if ROOT/"work" not in d.parents:raise Failure("Only own private disposable work artifacts accepted")
 storage=helper.private_storage()
 video="video-output.mp4" if a.dashboard else "node-video-output.mp4";preview="video-preview.png" if a.dashboard else "node-video-preview.png"
 for name in (video,preview):storage.require_private_file(d/name)
 png=(d/preview).read_bytes();width,height=struct.unpack(">II",png[16:24])
 python=ROOT/"installer/.runtime/video-python"/("Scripts/python.exe" if __import__("os").name=="nt" else "bin/python")
 exe=shutil.which("ffmpeg")
 if not exe:exe=subprocess.run([str(python),"-c","import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],capture_output=True,text=True,check=True).stdout.strip()
 r=subprocess.run([exe,"-v","error","-i",str(d/video),"-f","null","-"],capture_output=True,timeout=25)
 helper.private_write(d/("video-decode-diagnostic-"+secrets.token_hex(4)+".json"),{"returncode":r.returncode,"stderr":r.stderr.decode(errors="replace")})
 report={"actual_png_width":width,"actual_png_height":height,"actual_mp4_full_decode_passed":r.returncode==0,"mp4_bytes":(d/video).stat().st_size,"parity_status":"NOT_VERIFIED"}
 probe=shutil.which("ffprobe")
 if probe:
  q=subprocess.run([probe,"-v","error","-show_entries","stream=codec_name,width,height,r_frame_rate:format=duration","-of","json",str(d/video)],capture_output=True,text=True,check=True)
  report["actual_mp4_metadata"]=json.loads(q.stdout)
 if a.dashboard:
  receipts=helper.private_read(d/"receipts-10.json");created=helper.private_read(d/"report-10.json")["created"]
  details=[]
  for entry in receipts:
   content=entry.get("result",{}).get("content",[])
   if not isinstance(content,list):continue
   for item in content:
    if not isinstance(item,dict):continue
    if item.get("type")!="text":continue
    try:value=json.loads(item.get("text",""))
    except ValueError:continue
    project=value.get("project",{}) if isinstance(value,dict) else {}
    if project.get("id")==created["video_project"] and "spec" in project:details.append(project)
  matched=any((v.get("width"),v.get("height"),v.get("fps"))==(240,240,10) and v["spec"]["canvas"]=={"width":240,"height":240,"fps":10} for v in details)
  report["actual_tool_video_detail_metadata_matches_spec"]=matched
  if not matched:raise Failure("Actual tool detail receipt has inconsistent video metadata")
 (ROOT/"qa/results/video-artifact-verification.json").write_text(json.dumps(report,indent=2))
 print(json.dumps(report))
 return 0 if r.returncode==0 else 1
if __name__=="__main__":raise SystemExit(main())
