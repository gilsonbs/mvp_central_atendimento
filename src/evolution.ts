import type pg from 'pg';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';
import { z } from 'zod';
const payload = z.object({event:z.string(),instance:z.string(),data:z.object({key:z.object({id:z.string().min(1).max(256),remoteJid:z.string(),remoteJidAlt:z.string().optional(),fromMe:z.boolean()}),pushName:z.string().optional(),message:z.object({conversation:z.string().optional(),extendedTextMessage:z.object({text:z.string()}).optional()}).optional()})});
export function evolutionWebhook(pool:pg.Pool){
 return async(req:Request,res:Response)=>{
 const secret=process.env.EVOLUTION_WEBHOOK_SECRET;
 const supplied=req.params.secret;
 if(!secret || secret.length<32 || typeof supplied!=='string' || Buffer.byteLength(supplied)!==Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))){res.sendStatus(401);return;}
 const p=payload.safeParse(req.body);
 if(!p.success){res.json({ignored:true});return;}
 const {event,instance,data}=p.data;
 if(event.toLowerCase().replace(/_/g,'.')!=='messages.upsert'||instance!==(process.env.EVOLUTION_INSTANCE||'central-teste')||data.key.fromMe){res.json({ignored:true});return;}
 const jid=[data.key.remoteJid,data.key.remoteJidAlt].find(j=>j&&/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/.test(j));
 const body=data.message?.conversation??data.message?.extendedTextMessage?.text;
 if(!jid||!body||body.length>16000){res.json({ignored:true});return;}
 const phone='+'+jid.split('@')[0];
 const result=await transaction(pool,async db=>{
 if((await db.query('SELECT id FROM whatsapp_messages WHERE instance=$1 AND provider_message_id=$2',[instance,data.key.id])).rowCount)return {duplicate:true};
 const customer=(await db.query('INSERT INTO customers(name,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id',[(data.pushName?.trim()||phone).slice(0,120),phone])).rows[0];
 let attendance=(await db.query("SELECT id FROM attendances WHERE customer_id=$1 AND status IN ('waiting','active')",[customer.id])).rows[0];
 if(!attendance){
 attendance=(await db.query('INSERT INTO attendances(customer_id) VALUES($1) RETURNING id',[customer.id])).rows[0];
 await db.query("INSERT INTO attendance_events(attendance_id,actor_id,action) VALUES($1,NULL,'queued')",[attendance.id]);
 // Preferência somente para o primeiro da fila, dentro da transação do motor.
 const head=(await db.query("SELECT id FROM attendances WHERE status='waiting' ORDER BY priority DESC,created_at,id LIMIT 1")).rows[0];
 if(head?.id===attendance.id){
 const previous=(await db.query("SELECT seller_id FROM attendances WHERE customer_id=$1 AND status='closed' AND closed_at>=now()-interval '24 hours' ORDER BY closed_at DESC,id DESC LIMIT 1",[customer.id])).rows[0];
 if(previous?.seller_id){
 const seller=(await db.query("SELECT id FROM users WHERE id=$1 AND role='seller' AND enabled AND available",[previous.seller_id])).rows[0];
 if(seller){
 const occupied=(await db.query("SELECT slot FROM attendances WHERE seller_id=$1 AND status='active'",[seller.id])).rows.map(r=>r.slot);
 const slot=[1,2].find(s=>!occupied.includes(s));
 if(slot){
 await db.query("UPDATE attendances SET status='active',seller_id=$2,slot=$3,started_at=now() WHERE id=$1",[attendance.id,seller.id,slot]);
 await db.query("UPDATE users SET last_assigned_at=now() WHERE id=$1",[seller.id]);
 await db.query("INSERT INTO attendance_events(attendance_id,actor_id,action,to_seller_id) VALUES($1,NULL,'claimed',$2)",[attendance.id,seller.id]);
 }
 }
 }
 }
 }
 await db.query('INSERT INTO whatsapp_messages(instance,provider_message_id,attendance_id,body) VALUES($1,$2,$3,$4)',[instance,data.key.id,attendance.id,body]);
 return {accepted:true};
 });
 res.json(result);
 };
}
