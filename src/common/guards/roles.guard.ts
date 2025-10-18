import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator'; // seu decorator deve definir essa metadata
// ROLES_KEY: string = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // user.roles precisa ser array
    const userRoles: string[] = Array.isArray(user?.roles) ? user.roles : [];
    const ok = required.some(r => userRoles.includes(r));

    if (!ok) {
      throw new ForbiddenException('Você não tem permissão para esta ação');
    }
    return true;
    }
}
