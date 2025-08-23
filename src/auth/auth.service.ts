import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private signAccessToken(user: { id: string; email: string; roles: string[] }) {
    const payload = { sub: user.id, email: user.email, roles: user.roles };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: `${process.env.JWT_ACCESS_TTL || 3600}s`,
    });
  }

  private signRefreshToken(user: { id: string }) {
    const payload = { sub: user.id, type: 'refresh' };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: `${process.env.JWT_REFRESH_TTL || 2592000}s`,
    });
  }

  async register(name: string, email: string, password: string, roles?: any[]) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new UnauthorizedException('E-mail já registrado');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { name, email, passwordHash, roles: roles?.length ? roles : ['SPONSOR'] },
    });
    return { id: user.id, name: user.name, email: user.email, roles: user.roles };
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Credenciais inválidas');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const access_token = await this.signAccessToken({ id: user.id, email: user.email, roles: user.roles as any });
    const refresh_token = await this.signRefreshToken({ id: user.id });
    const refreshHash = await bcrypt.hash(refresh_token, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshHash } });
    return {
      user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
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

      const access_token = await this.signAccessToken({ id: user.id, email: user.email, roles: user.roles as any });
      // Rotação opcional do refresh:
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
    return { id: me.id, name: me.name, email: me.email, roles: me.roles };
  }
}
