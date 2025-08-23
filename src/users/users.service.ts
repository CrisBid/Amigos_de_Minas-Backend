import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.user.findMany({ select: { id:true, name:true, email:true, roles:true, createdAt:true } }); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id }, select: { id:true, name:true, email:true, roles:true } }); }
}
