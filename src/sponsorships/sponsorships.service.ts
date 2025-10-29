import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSponsorshipDto, SponsorshipMethod } from './dto/sponsorships.dto';
import { Prisma, SponsorshipStatus } from '@prisma/client'; // 👈 usar enum do Prisma

type AppUser = { sub: string; roles?: string[] };

type CreateOneArgs = {
  childId: string;
  sponsorUserId: string;
  campaignId: string;
  method: SponsorshipMethod;
  note?: string;
  donationAmount?: number;
  pixTxid?: string;
  // >>> novo
  collectionPointId?: string | null;
};

type CreateManyArgs = {
  childIds: string[];
  sponsorUserId: string;
  campaignId: string;
  method: SponsorshipMethod;
  note?: string;
  donationAmount?: number;
  pixTxid?: string;
  // >>> novo
  collectionPointId?: string | null;
};

@Injectable()
export class SponsorshipsService {
  constructor(private prisma: PrismaService) {}

  // ========= SELECTS/INCLUDES PADRÃO (reuso) =========

  // Dados do filho compatíveis com o ChildCard/ComposedImage
  private childSelectFull = Prisma.validator<Prisma.ChildSelect>()({
    id: true,
    publicId: true,
    name: true,
    age: true,
    photoUrl: true,
    category: true,
    wantedGift: true,
    description: true,

    // se você tiver esses campos “legado”, pode manter
    cityName: true,
    schoolLegacy: true,

    // relações para nomes (a UI usa .name)
    city: { select: { id: true, name: true } },
    community: { select: { id: true, name: true } },
    school: { select: { id: true, name: true } },

    // imagens processadas (shape usado por pickComposeInputsFromImages)
    images: {
      select: {
        id: true,
        childId: true,
        campaignId: true,
        originalUrl: true,
        processedUrl: true,
        framedUrl: true,
        layoutUrl: true,
        Config: true,       // JSON do layout
        width: true,
        height: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    },

    // opcional: se você tiver uma relação “media”
    /*
    media: {
      select: {
        framedUrl: true,
        processedUrl: true,
      },
    },
    */
    // Se precisar, traga sponsorships, mas geralmente não é necessário aqui
    // sponsorships: { select: { id: true, status: true, campaignId: true } },
  });

  // Campanha resumida (suficiente para o agrupamento)
  private campaignSelectShort = Prisma.validator<Prisma.CampaignSelect>()({
    id: true,
    name: true,
    slug: true,
    year: true,
    status: true,
    startDate: true,
    endDate: true,
  });

  private collectionPointSelect = Prisma.validator<Prisma.CollectionPointSelect>()({
    id: true, name: true, address: true, district: true,
    cityName: true, state: true, zipCode: true, phone: true,
  });

  // Select de sponsorship para a rota /me
  private sponsorshipSelectForMe = Prisma.validator<Prisma.SponsorshipSelect>()({
    id: true,
    status: true,
    startDate: true,
    endDate: true,
    note: true,
    method: true,
    donationAmount: true,
    pixTxid: true,
    pixPaidAt: true,
    createdAt: true,

    child: { select: this.childSelectFull },
    campaign: { select: this.campaignSelectShort },
    collectionPoint: { select: this.collectionPointSelect },
  });

  /** Mantém compatibilidade do fluxo antigo (um único childId) */
  async create(args: CreateOneArgs) {
    return this.createOne(args);
  }

    async createOne(args: CreateOneArgs) {
    const { childId, sponsorUserId, campaignId, method, note, donationAmount, pixTxid, collectionPointId } = args;

    const child = await this.prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
    if (!child) throw new BadRequestException(`childId inválido: ${childId}`);

    const dup = await this.prisma.sponsorship.findUnique({
      where: { childId_campaignId: { childId, campaignId } },
    });
    if (dup) throw new BadRequestException('Esta criança já está vinculada a esta campanha.');

    if (method === 'GIFT') {
      if (!collectionPointId) throw new BadRequestException('collectionPointId é obrigatório para método GIFT.');
      const exists = await this.prisma.collectionPoint.findUnique({ where: { id: collectionPointId } });
      if (!exists) throw new BadRequestException('Ponto de coleta inválido.');
    }

    return this.prisma.sponsorship.create({
      data: {
        childId,
        sponsorId: sponsorUserId,
        campaignId,
        method,
        note,
        status: SponsorshipStatus.PENDING, // 👈 enum do Prisma
        donationAmount: donationAmount != null ? new Prisma.Decimal(donationAmount) : undefined,
        pixTxid,
        collectionPointId: collectionPointId ?? null,
      },
      select: this.sponsorshipSelectForMe,
    });
  }

  /** Criação em massa */
  async createMany(args: CreateManyArgs) {
    const { childIds, sponsorUserId, campaignId, method, note, donationAmount, pixTxid, collectionPointId } = args;

    const uniqueIds = [...new Set(childIds.map((s) => s.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) throw new BadRequestException('Lista de childIds vazia.');

    const found = await this.prisma.child.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    const foundSet = new Set(found.map((c) => c.id));
    const missingIds = uniqueIds.filter((id) => !foundSet.has(id));

    const existing = await this.prisma.sponsorship.findMany({
      where: { campaignId, childId: { in: uniqueIds } },
      select: { childId: true },
    });
    const duplicatedIds = Array.from(new Set(existing.map((e) => e.childId)));
    const eligibleIds = uniqueIds.filter((id) => foundSet.has(id) && !duplicatedIds.includes(id));

    // >>> mesma regra do createOne
    if (method === 'GIFT') {
      if (!collectionPointId) throw new BadRequestException('collectionPointId é obrigatório para método GIFT.');
      const exists = await this.prisma.collectionPoint.findUnique({ where: { id: collectionPointId } });
      if (!exists) throw new BadRequestException('Ponto de coleta inválido.');
    }

    if (eligibleIds.length === 0) {
      return {
        created: 0,
        createdItems: [],
        skipped: { missingIds, duplicatedIds },
        message: 'Nenhum apadrinhamento pôde ser criado (IDs ausentes ou já vinculados à campanha).',
      };
    }

    const createdItems = await this.prisma.$transaction(
      eligibleIds.map((id) =>
        this.prisma.sponsorship.create({
          data: {
            childId: id,
            sponsorId: sponsorUserId,
            campaignId,
            method,
            note,
            status: SponsorshipStatus.PENDING, // 👈 enum do Prisma
            donationAmount: donationAmount != null ? new Prisma.Decimal(donationAmount) : undefined,
            pixTxid,
            collectionPointId: collectionPointId ?? null,
          },
          select: this.sponsorshipSelectForMe,
        })
      )
    );

    return {
      created: createdItems.length,
      createdItems,
      skipped: { missingIds, duplicatedIds },
    };
  }

  // ====== AQUI: rota /sponsorships/me com child completo ======
  mine(sponsorUserId: string, campaignId?: string) {
    return this.prisma.sponsorship.findMany({
      where: { sponsorId: sponsorUserId, ...(campaignId ? { campaignId } : {}) },
      select: this.sponsorshipSelectForMe,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  listAll(campaignId?: string) {
    return this.prisma.sponsorship.findMany({
      where: campaignId ? { campaignId } : undefined,
      include: {
        sponsor: {
          select: { id: true, name: true, email: true },
        },
        campaign: {
          select: { id: true, name: true, year: true, slug: true, status: true },
        },
        collectionPoint: {
          select: { id: true, name: true, cityName: true, state: true, address: true },
        },
        child: {
          select: {
            id: true,
            publicId: true,
            name: true,
            age: true,
            wantedGift: true,
            category: true,
            cityId: true,
            cityName: true,
            communityId: true,
            photoUrl: true,
            // 👇 adiciona aqui os relacionamentos reais:
            city: { select: { id: true, name: true } },
            community: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async activate(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: SponsorshipStatus.COMPLETED, startDate: new Date() }, // 👈
    });
  }

  async end(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: SponsorshipStatus.ENDED, endDate: new Date() }, // 👈
    });
  }

  async update(id: string, dto: UpdateSponsorshipDto, user: AppUser) {
    const current = await this.prisma.sponsorship.findUnique({
      where: { id },
      include: { sponsor: { select: { id: true } } },
    });
    if (!current) throw new NotFoundException('Apadrinhamento não encontrado.');

    const roles = user?.roles ?? [];
    const isAdminOrStaff = roles.includes('ADMIN') || roles.includes('STAFF');
    const isSponsor = current.sponsor?.id === user?.sub;
    const isSponsorOnly = isSponsor && !isAdminOrStaff;

    if (!isAdminOrStaff && !isSponsor) {
      throw new ForbiddenException('Você não tem permissão para alterar este apadrinhamento.');
    }

    const updates: any = {};

    if (dto.note !== undefined) updates.note = dto.note;
    if (dto.method) updates.method = dto.method;
    if (dto.donationAmount != null) updates.donationAmount = dto.donationAmount;
    if (dto.pixTxid != null) updates.pixTxid = dto.pixTxid;

    if (dto.pixPaidAt) {
      const d = new Date(dto.pixPaidAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('pixPaidAt inválido.');
      updates.pixPaidAt = d;
    }

    if (isAdminOrStaff) {
      if (dto.status) updates.status = dto.status;

      if (dto.startDate) {
        const d = new Date(dto.startDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('startDate inválido.');
        updates.startDate = d;
      }
      if (dto.endDate) {
        const d = new Date(dto.endDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('endDate inválido.');
        updates.endDate = d;
      }
    }

    // ---------- Restrições para quem é SÓ sponsor ----------
    if (isSponsorOnly) {
      if (dto.startDate || dto.endDate) {
        throw new BadRequestException('Você não pode alterar datas deste apadrinhamento.');
      }

      if (dto.status && dto.status !== SponsorshipStatus.CANCELLED) {
        throw new BadRequestException('Você só pode cancelar seu apadrinhamento.');
      }

      if (dto.status === SponsorshipStatus.CANCELLED) {
        // ✅ pode cancelar se estiver em PENDING ou em QUALQUER estágio de progresso
        const cancellableFrom: SponsorshipStatus[] = [
          SponsorshipStatus.PENDING,
          SponsorshipStatus.IN_PROGRESS,
          SponsorshipStatus.IN_PURCHASE,
          SponsorshipStatus.PACKED,
          SponsorshipStatus.BOXED,
          SponsorshipStatus.AWAITING_DELIVERY,
        ];
        if (!cancellableFrom.includes(current.status as SponsorshipStatus)) {
          throw new BadRequestException('Não é possível cancelar neste estágio.');
        }
        updates.status = SponsorshipStatus.CANCELLED;
        if (!current.endDate) updates.endDate = new Date();
      }

      // Método só enquanto está PENDING
      if (dto.method && current.status !== SponsorshipStatus.PENDING) {
        throw new BadRequestException('Não é possível alterar o método após sair de PENDING.');
      }
    }

    // ---------- Ajustes automáticos úteis ----------
    if (isAdminOrStaff && dto.status) {
      if (dto.status === SponsorshipStatus.COMPLETED && !updates.startDate && !current.startDate) {
        updates.startDate = new Date();
      }
      if ([SponsorshipStatus.ENDED, SponsorshipStatus.CANCELLED].includes(dto.status as any) && !updates.endDate) {
        updates.endDate = new Date();
      }
    }

    // ---------- Consistência de datas ----------
    const finalStart = updates.startDate ?? current.startDate ?? null;
    const finalEnd = updates.endDate ?? current.endDate ?? null;
    if (finalStart && finalEnd && finalStart > finalEnd) {
      throw new BadRequestException('startDate não pode ser posterior a endDate.');
    }

    if (dto.collectionPointId !== undefined) {
      if (dto.collectionPointId === null || dto.collectionPointId === '') {
        updates.collectionPointId = null;
      } else {
        const exists = await this.prisma.collectionPoint.findUnique({ where: { id: dto.collectionPointId } });
        if (!exists) throw new BadRequestException('Ponto de coleta inválido.');
        updates.collectionPointId = dto.collectionPointId;
      }
    }

    return this.prisma.sponsorship.update({
      where: { id },
      data: updates,
      include: {
        child: true,
        sponsor: { select: { id: true, name: true, email: true } },
        campaign: true,
        collectionPoint: { select: this.collectionPointSelect },
      },
    });
  }

  async transfer(sponsorshipIds: string[], toSponsorId: string) {
    // valida destino
    const dest = await this.prisma.user.findUnique({ where: { id: toSponsorId } });
    if (!dest) throw new NotFoundException('Padrinho destino não encontrado');

    // atualiza em lote
    await this.prisma.sponsorship.updateMany({
      where: { id: { in: sponsorshipIds } },
      data: { sponsorId: toSponsorId },
    });

    // opcional: retornar quantos foram alterados
    return { transferred: sponsorshipIds.length, toSponsorId };
  }


  async remove(id: string, user: AppUser) {
    const current = await this.prisma.sponsorship.findUnique({
      where: { id },
      select: { id: true, status: true, sponsorId: true },
    });
    if (!current) throw new NotFoundException('Apadrinhamento não encontrado.');

    const roles = user?.roles ?? [];
    const isAdminOrStaff = roles.includes('ADMIN') || roles.includes('STAFF');
    const isSponsor = current.sponsorId === user?.sub;

    if (isSponsor && current.status !== SponsorshipStatus.PENDING) {
      throw new ForbiddenException('Você só pode excluir apadrinhamentos em estado PENDING.');
    }
    if (!isAdminOrStaff && !isSponsor) {
      throw new ForbiddenException('Você não tem permissão para excluir este apadrinhamento.');
    }

    await this.prisma.sponsorship.delete({ where: { id } });
    return { ok: true, deletedId: id };
  }
}
