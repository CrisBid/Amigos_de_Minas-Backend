import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private normalizePhone(phone?: string | null) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    return digits || null;
  }

  private signAccessToken(user: { id: string; email: string; roles: string[] }) {
    const payload = { sub: user.id, email: user.email, roles: user.roles };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      // segundos (number) — evita depender do tipo literal `${number}s` do jsonwebtoken
      expiresIn: Number(process.env.JWT_ACCESS_TTL) || 3600,
    });
  }

  private signRefreshToken(user: { id: string }) {
    const payload = { sub: user.id, type: 'refresh' };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: Number(process.env.JWT_REFRESH_TTL) || 2592000,
    });
  }

  async register(dto: RegisterDto) {
    const { name, email, password, roles, phone, cep, address, city, profession, incomeRange, maritalStatus } = dto;

    // checa duplicidade por email/phone
    const phoneNorm = this.normalizePhone(phone);
    const exists = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email },
          ...(phoneNorm ? [{ phone: phoneNorm }] : []),
        ],
      },
      select: { id: true, email: true, phone: true },
    });
    if (exists) {
      if (exists.email === email) throw new UnauthorizedException('E-mail já registrado');
      if (phoneNorm && exists.phone === phoneNorm) throw new UnauthorizedException('Telefone já registrado');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // cria User + (Profile)
    // Se preferir, pode condicionar a criação do profile: só cria se algum campo veio.
    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        phone: phoneNorm,
        passwordHash,
        roles: roles?.length ? roles : ['SPONSOR'],
        profile: {
          create: {
            phone: phoneNorm ?? undefined,
            cep: cep ?? undefined,
            address: address ?? undefined,
            city: city ?? undefined,
            profession: profession ?? undefined,
            incomeRange: incomeRange ?? undefined,
            maritalStatus: maritalStatus ?? undefined,
          },
        },
      },
      include: { profile: true },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      profile: user.profile,
    };
  }

  private async findUserByIdentifier(identifier: string) {
    if (identifier.includes('@')) {
      // e-mail
      return this.prisma.user.findUnique({ where: { email: identifier } });
    }
    // telefone
    const phoneNorm = this.normalizePhone(identifier);
    if (!phoneNorm) return null;
    return this.prisma.user.findUnique({ where: { phone: phoneNorm } });
  }

  async validateUser(identifier: string, password: string) {
    const user = await this.findUserByIdentifier(identifier);
    if (!user) throw new UnauthorizedException('Credenciais inválidas');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');
    return user;
  }

  async login(identifier: string, password: string) {
    const user = await this.validateUser(identifier, password);
    const access_token = await this.signAccessToken({
      id: user.id,
      email: user.email,
      roles: user.roles as any,
    });
    const refresh_token = await this.signRefreshToken({ id: user.id });
    const refreshHash = await bcrypt.hash(refresh_token, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshHash } });
    return {
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, roles: user.roles },
      access_token,
      refresh_token,
      expires_in: Number(process.env.JWT_ACCESS_TTL || 3600),
    };
  }

  async refresh(refresh_token: string) {
    try {
      const payload = await this.jwt.verifyAsync(refresh_token, { secret: process.env.JWT_REFRESH_SECRET });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.refreshHash) throw new UnauthorizedException('Refresh inválido');
      const ok = await bcrypt.compare(refresh_token, user.refreshHash);
      if (!ok) throw new UnauthorizedException('Refresh inválido');

      const access_token = await this.signAccessToken({
        id: user.id,
        email: user.email,
        roles: user.roles as any,
      });
      const new_refresh_token = await this.signRefreshToken({ id: user.id });
      const newHash = await bcrypt.hash(new_refresh_token, 10);
      await this.prisma.user.update({ where: { id: user.id }, data: { refreshHash: newHash } });

      return {
        access_token,
        refresh_token: new_refresh_token,
        expires_in: Number(process.env.JWT_ACCESS_TTL || 3600),
      };
    } catch {
      throw new UnauthorizedException('Refresh inválido');
    }
  }

  async me(user: any) {
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!me) throw new UnauthorizedException();
    return { id: me.id, name: me.name, email: me.email, phone: me.phone, roles: me.roles };
  }
}
