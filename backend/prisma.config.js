// prisma.config.js — plain JS version so it works in any Node environment (e.g. Render)
require("dotenv/config");

/** @type {import('prisma/config').PrismaConfig} */
module.exports = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
};
