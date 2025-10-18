import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCollectionPointDto, UpdateCollectionPointDto } from './dto/collection-point.dto'

@Injectable()
export class CollectionPointsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateCollectionPointDto) {
    return this.prisma.collectionPoint.create({ data: { ...dto } })
  }

  async get(id: string) {
    const cp = await this.prisma.collectionPoint.findUnique({ where: { id } })
    if (!cp) throw new NotFoundException('Ponto de coleta não encontrado.')
    return cp
  }

  list(opts: { q?: string; active?: boolean; city?: string; state?: string }) {
    const where: any = {}
    if (typeof opts.active === 'boolean') where.active = opts.active
    if (opts.city) where.cityName = { contains: opts.city, mode: 'insensitive' }
    if (opts.state) where.state = { equals: opts.state, mode: 'insensitive' }
    if (opts.q?.trim()) {
      const q = opts.q.trim()
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { district: { contains: q, mode: 'insensitive' } },
        { cityName: { contains: q, mode: 'insensitive' } },
        { state: { contains: q, mode: 'insensitive' } },
      ]
    }
    return this.prisma.collectionPoint.findMany({
      where,
      orderBy: [{ active: 'desc' }, { cityName: 'asc' }, { name: 'asc' }],
    })
  }

  async update(id: string, dto: UpdateCollectionPointDto) {
    await this.get(id)
    return this.prisma.collectionPoint.update({ where: { id }, data: { ...dto } })
  }
}
