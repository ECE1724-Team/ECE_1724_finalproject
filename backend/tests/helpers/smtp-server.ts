import { createServer, type Socket } from "node:net";

export type SmtpDataReply = "accept" | "reject" | "disconnect";

export interface PausedSmtpServer {
  readonly port: number;
  readonly receivedMessages: number;
  readonly acceptedMessages: number;
  /** Waits until DATA has arrived, before SMTP has accepted the message. */
  waitForData(): Promise<void>;
  /** Completes the oldest waiting DATA transaction. No message bytes are logged. */
  respond(reply: SmtpDataReply): void;
  close(): Promise<void>;
}

/** A bounded wait whose diagnostic never includes an email address or token. */
export async function smtpDeadline<T>(work: Promise<T>, message: string, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Minimal local SMTP peer for acceptance-boundary tests. It advertises neither
 * AUTH nor STARTTLS, accepts a message envelope, and withholds the final DATA
 * response until the test selects success, rejection, or connection failure.
 * It never contacts an upstream server and does not retain message content.
 */
export async function createPausedSmtpServer(): Promise<PausedSmtpServer> {
  const sockets = new Set<Socket>();
  const awaitingReply: Socket[] = [];
  let receivedMessages = 0;
  let acceptedMessages = 0;
  let closed = false;
  let notifyData!: () => void;
  const firstData = new Promise<void>((resolve) => { notifyData = resolve; });

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on("error", () => { /* Failure is observed by Nodemailer, not logged. */ });
    socket.on("close", () => {
      sockets.delete(socket);
      const index = awaitingReply.indexOf(socket);
      if (index >= 0) awaitingReply.splice(index, 1);
    });

    let buffer = "";
    let readingData = false;
    socket.write("220 localhost JobFlow test SMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const boundary = buffer.indexOf("\r\n");
        if (boundary < 0) break;
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (readingData) {
          if (line === ".") {
            readingData = false;
            receivedMessages += 1;
            awaitingReply.push(socket);
            notifyData();
          }
          continue;
        }

        if (/^(?:EHLO|HELO)\b/i.test(line)) socket.write("250 localhost\r\n");
        else if (/^MAIL FROM:/i.test(line)) socket.write("250 2.1.0 Sender accepted\r\n");
        else if (/^RCPT TO:/i.test(line)) socket.write("250 2.1.5 Recipient accepted\r\n");
        else if (/^DATA$/i.test(line)) {
          readingData = true;
          socket.write("354 End data with <CRLF>.<CRLF>\r\n");
        } else if (/^(?:RSET|NOOP)$/i.test(line)) socket.write("250 2.0.0 OK\r\n");
        else if (/^QUIT$/i.test(line)) socket.end("221 2.0.0 Bye\r\n");
        else socket.write("502 5.5.1 Command not supported\r\n");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The local SMTP test server did not acquire a TCP port");
  }

  return {
    port: address.port,
    get receivedMessages() { return receivedMessages; },
    get acceptedMessages() { return acceptedMessages; },
    async waitForData() {
      await smtpDeadline(firstData, "The local SMTP peer did not receive DATA");
      if (closed && receivedMessages === 0) throw new Error("The local SMTP peer closed before receiving DATA");
    },
    respond(reply) {
      const socket = awaitingReply.shift();
      if (!socket || socket.destroyed) throw new Error("No SMTP DATA transaction is awaiting a response");
      if (reply === "accept") {
        acceptedMessages += 1;
        socket.write("250 2.0.0 Message accepted\r\n");
      } else if (reply === "reject") {
        socket.write("550 5.7.1 Message rejected\r\n");
      } else {
        socket.destroy();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      notifyData();
      for (const socket of sockets) socket.destroy();
      awaitingReply.length = 0;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
