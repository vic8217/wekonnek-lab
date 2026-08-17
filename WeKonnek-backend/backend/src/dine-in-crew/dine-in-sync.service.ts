import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DineInSyncGateway } from './dine-in-sync.gateway';

@Injectable()
export class DineInSyncService{
 constructor(private readonly prisma:PrismaService,private readonly gateway:DineInSyncGateway){}
 async record(shopId:number|undefined|null,type:string,entityId:string|number|null,payload:Record<string,unknown>={}){if(!shopId)return null;const change=await this.prisma.dineInChange.create({data:{shopId,type,entityId:entityId==null?null:String(entityId),payload:payload as any}});const cursor=change.id.toString();this.gateway.emitChange(shopId,cursor,type);return cursor}
 async recordOrder(orderId:number,type:string){const order=await this.prisma.wkOrder.findUnique({where:{id:orderId},include:{orderItems:true}});if(!order)return null;return this.record(order.shopId,type,order.id,{order:{id:order.id,orderCode:order.orderCode,orderType:order.orderType,status:order.status,tableNumber:order.tableNumber,totalAmount:Number(order.totalAmount),notes:order.notes,createdAt:order.createdAt,paymentMethod:order.paymentMethod,discountType:order.discountType,discountAmount:Number(order.discountAmount),discountDetails:order.discountDetails,items:order.orderItems.map(item=>({id:item.id,productName:item.productName,quantity:item.quantity,price:Number(item.price),subtotal:Number(item.subtotal),status:item.status||'preparing'}))}})}
 async cursor(shopId:number){const row=await this.prisma.dineInChange.findFirst({where:{shopId},orderBy:{id:'desc'},select:{id:true}});return row?.id.toString()||'0'}
 async changes(shopId:number,cursor:string){let id:bigint;try{id=BigInt(cursor||'0')}catch{id=0n}const rows=await this.prisma.dineInChange.findMany({where:{shopId,id:{gt:id}},orderBy:{id:'asc'},take:200,select:{id:true,type:true,entityId:true,payload:true,createdAt:true}});return{nextCursor:rows.length?rows[rows.length-1].id.toString():await this.cursor(shopId),changes:rows.map(row=>({cursor:row.id.toString(),type:row.type,entityId:row.entityId,payload:row.payload,createdAt:row.createdAt}))}}
}
