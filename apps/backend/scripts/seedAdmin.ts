/**
 * One-time bootstrap for the very first ADMIN account. There is no
 * chicken-and-egg-free way to create an admin through the API (creating
 * sales officers requires an existing admin), so this script exists to
 * seed exactly one. Run once per environment:
 *
 *   npx tsx scripts/seedAdmin.ts +919876500000
 *
 * The phone then logs in through the normal OTP flow like any other user
 * — this does not create a second auth system, it just pre-creates the
 * User row with role=ADMIN before that first login.
 */
import { prisma } from "../src/db/prisma";

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error("Usage: npx tsx scripts/seedAdmin.ts <phone>");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    if (existing.role === "ADMIN") {
      console.log(`${phone} is already an ADMIN.`);
      return;
    }
    await prisma.user.update({ where: { phone }, data: { role: "ADMIN" } });
    console.log(`${phone} promoted to ADMIN.`);
    return;
  }

  await prisma.user.create({ data: { phone, role: "ADMIN" } });
  console.log(`Created ADMIN user ${phone}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
