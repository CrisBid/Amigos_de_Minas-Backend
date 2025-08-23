import { PrismaClient } from "@prisma/client"
import * as bcrypt from "bcrypt"

const prisma = new PrismaClient()

async function main() {
  const adminEmail = "admin@amigosdeminas.org"
  const hash = await bcrypt.hash("admin123", 10)
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Admin",
      email: adminEmail,
      passwordHash: hash,
      roles: ["ADMIN", "STAFF"],
    },
  })

  await prisma.child.createMany({
    data: [
      { name: "Ana Clara", age: 8, city: "Bonito de Minas", school: "Escola Francisco Borges-Larga", category: "Bonecas", wantedGift: "Boneca", photoUrl: "", description: "Ama brincar de casinha e desenhar" },
      { name: "João Pedro", age: 6, city: "Bonito de Minas", school: "Escola Galho de São Domingos", category: "Carrinhos", wantedGift: "Carrinho", photoUrl: "", description: "Gosta de pipa e bola" },
    ],
    skipDuplicates: true,
  })
}

main().finally(() => prisma.$disconnect())
