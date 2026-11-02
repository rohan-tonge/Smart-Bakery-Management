import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.set-cookie",
      "res.headers.set-cookie",
      "password",
      "refreshToken",
      "accessToken",
      "secret",
      "*.password",
      "*.refreshToken",
      "*.refreshTokenHash",
      "*.passwordHash",
      "*.keySecret",
      "*.webhookSecret",
      "*.cookieSecret",
    ],
    remove: true,
  },
});

export default logger;
