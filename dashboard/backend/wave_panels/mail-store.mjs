// Agent13 Store record interface; same durable SQLite schema and operations used by StudioDelivery.
import {DatabaseSync} from 'node:sqlite';
export class MailStore{
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=1000;PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL,id TEXT NOT NULL,owner TEXT,payload TEXT NOT NULL,PRIMARY KEY(collection,id));');}
 get(collection,id){const row=this.db.prepare('SELECT payload FROM records WHERE collection=? AND id=?').get(collection,id);return row?JSON.parse(row.payload):undefined;}
 list(collection){return this.db.prepare('SELECT payload FROM records WHERE collection=?').all(collection).map(r=>JSON.parse(r.payload));}
 put(collection,value,owner){this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET owner=excluded.owner,payload=excluded.payload').run(collection,value.id,owner??value.ownerId??null,JSON.stringify(value));return value;}
 close(){this.db.close();}
}
