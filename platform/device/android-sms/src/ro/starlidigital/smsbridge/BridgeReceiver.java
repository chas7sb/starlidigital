package ro.starlidigital.smsbridge;
import android.Manifest;import android.app.PendingIntent;import android.content.*;import android.content.pm.PackageManager;import android.telephony.SmsManager;import android.telephony.SubscriptionManager;import android.util.Base64;import org.json.*;import java.util.*;import java.security.MessageDigest;

public class BridgeReceiver extends BroadcastReceiver {
 static String key(String id){return "request:"+id;}
 static SharedPreferences prefs(Context c){return c.getSharedPreferences("receipts",Context.MODE_PRIVATE);}
 static JSONObject load(Context c,String id)throws Exception{return new JSONObject(prefs(c).getString(key(id),"{\"state\":\"NOT_FOUND\"}"));}
 static void save(Context c,String id,JSONObject row)throws Exception{row.put("updatedAt",System.currentTimeMillis());if(!prefs(c).edit().putString(key(id),row.toString()).commit())throw new Exception("Receipt persistence failed");}
 static String fingerprint(String to,String body)throws Exception{byte[] bytes=MessageDigest.getInstance("SHA-256").digest((to+"\n"+body).getBytes("UTF-8"));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b));return out.toString();}
 @Override public void onReceive(Context c,Intent i){try{
  String action=i.getStringExtra("operation"),id=i.getStringExtra("requestId");
  if("health".equals(action)){setResultData(new JSONObject().put("bridgeVersion",1).put("sendPermission",c.checkSelfPermission(Manifest.permission.SEND_SMS)==PackageManager.PERMISSION_GRANTED).put("subscriptionId",SubscriptionManager.getDefaultSmsSubscriptionId()).toString());return;}
  if("status".equals(action)){setResultData(load(c,id).toString());return;}
  JSONObject payload=new JSONObject(new String(Base64.decode(i.getStringExtra("payload"),Base64.DEFAULT),"UTF-8"));id=payload.getString("requestId");String to=payload.getString("to"),body=payload.getString("body");
  if(!id.matches("[A-Za-z0-9_-]{1,120}")||!to.matches("\\+[1-9][0-9]{7,14}")||body.isEmpty()||body.length()>4096)throw new Exception("Invalid request");
  String hash=fingerprint(to,body);JSONObject previous=load(c,id);if(!"NOT_FOUND".equals(previous.optString("state"))){if(!hash.equals(previous.optString("fingerprint")))throw new Exception("Request ID content mismatch");setResultData(previous.toString());return;}
  if(c.checkSelfPermission(Manifest.permission.SEND_SMS)!=PackageManager.PERMISSION_GRANTED){setResultData(new JSONObject().put("state","FAILED_BEFORE_SEND").put("error","SEND_SMS permission missing").toString());return;}
  SmsManager sms=SmsManager.getDefault();ArrayList<String> parts=sms.divideMessage(body);JSONObject row=new JSONObject().put("requestId",id).put("fingerprint",hash).put("state","SUBMITTING").put("parts",parts.size()).put("sent",new JSONArray()).put("delivered",new JSONArray());save(c,id,row);
  ArrayList<PendingIntent> sent=new ArrayList<>(),delivered=new ArrayList<>();for(int n=0;n<parts.size();n++){for(int k=0;k<2;k++){Intent receipt=new Intent(c,ReceiptReceiver.class).setAction("ro.starlidigital.smsbridge."+(k==0?"SENT":"DELIVERED")+"."+id+"."+n).putExtra("requestId",id).putExtra("part",n).putExtra("delivery",k==1);PendingIntent pi=PendingIntent.getBroadcast(c,(id+":"+n+":"+k).hashCode(),receipt,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);(k==0?sent:delivered).add(pi);}}
  try{sms.sendMultipartTextMessage(to,null,parts,sent,delivered);}catch(Exception error){row.put("state","UNKNOWN").put("error",error.getClass().getSimpleName()+": "+error.getMessage());save(c,id,row);}
  setResultData(load(c,id).toString());
 }catch(Exception error){try{setResultData(new JSONObject().put("state","REJECTED").put("error",error.getMessage()).toString());}catch(Exception ignored){}}}
}
