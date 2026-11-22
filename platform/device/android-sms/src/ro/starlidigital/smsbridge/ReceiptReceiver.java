package ro.starlidigital.smsbridge;
import android.app.Activity;import android.content.*;import org.json.*;
public class ReceiptReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent intent){try{String id=intent.getStringExtra("requestId");JSONObject row=BridgeReceiver.load(c,id);if("NOT_FOUND".equals(row.optString("state")))return;boolean delivery=intent.getBooleanExtra("delivery",false);int code=getResultCode();
  if(code!=Activity.RESULT_OK){if(!"DELIVERED".equals(row.optString("state"))){row.put("state",delivery?"DELIVERY_FAILED":"FAILED").put("resultCode",code).put("radioError",intent.getIntExtra("errorCode",0));BridgeReceiver.save(c,id,row);}return;}
  JSONArray done=row.getJSONArray(delivery?"delivered":"sent");int part=intent.getIntExtra("part",0);boolean exists=false;for(int n=0;n<done.length();n++)if(done.getInt(n)==part)exists=true;if(!exists)done.put(part);
  if(done.length()>=row.getInt("parts")){if(delivery)row.put("state","DELIVERED");else if(!"DELIVERED".equals(row.optString("state")))row.put("state","SENT");}BridgeReceiver.save(c,id,row);
 }catch(Exception ignored){}}
}
