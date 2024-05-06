import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";
import Fastify from "fastify";
import jsYaml from "js-yaml";

if (!process.env.IP_ADDRESS) {
  throw new Error("IP_ADDRESS is required");
}

const fastify = Fastify({
  logger: true,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOMAINS_FILE_LOCATIONS = __dirname + "/domains.json";

// ################################################################
// # Logic                                                        #
// ################################################################

/**
 * Read domains from storage
 * @returns {Promise<string[]>}
 */
async function readDomains() {
  try {
    const fileContent = await readFile(DOMAINS_FILE_LOCATIONS);
    return JSON.parse(fileContent.toString("utf-8"));
  } catch (error) {
    return [];
  }
}

/**
 * Write domain to storage
 * @param {string} domain - domain to write to storage
 * @returns {Promise<void>}
 */
async function writeDomain(domain) {
  const lookupAddress = await dnsLookup(domain);

  if (lookupAddress.address !== process.env.IP_ADDRESS) {
    throw new Error("Domain does not resolve to this server");
  }

  const domains = await readDomains();
  if (domains.includes(domain)) {
    return;
  }

  await writeFile(
    DOMAINS_FILE_LOCATIONS,
    Buffer.from(JSON.stringify([...domains, domain], false, 2), "utf-8")
  );
}

/**
 * Get proxy config as yaml
 * @returns {Promise<string>}
 */
async function getProxyConfigAsYaml() {
  const initialConfig = {
    http: {
      routers: {},
      middlewares: {
        ["redirect-to-https"]: {
          redirectScheme: { scheme: "https" },
        },
      },
      services: {
        ["proxy-controller"]: {
          loadBalancer: {
            passHostHeader: true,
            servers: [{ url: "http://proxy-controller:3000" }],
          },
        },
      },
    },
  };

  const domains = await readDomains();
  const config = domains.reduce((conf, domain, index) => {
    conf.http.routers[`router-${index}`] = {
      rule: `Host(\`${domain}\`)`,
      service: "proxy-controller",
      tls: { certResolver: "letsencrypt" },
      middlewares: ["redirect-to-https"],
      entryPoints: ["websecure", "web"],
    };
    return conf;
  }, initialConfig);

  return jsYaml.dump(config);
}

// ################################################################
// # Routes                                                       #
// ################################################################

// Declare a route
fastify.route({
  method: "GET",
  url: "/",
  handler: async (request, reply) => {
    // returns json describing the client
    const host = request.headers.host ?? "unknown";
    reply.send(`Hello, ${host}`);
  },
});

fastify.route({
  method: "POST",
  url: "/domains",
  schema: {
    body: {
      type: "object",
      required: ["domain"],
      properties: {
        domain: { type: "string" },
      },
    },
    response: {
      201: {
        type: "object",
        properties: {
          domain: { type: "string" },
        },
      },
    },
  },
  handler: async (request, reply) => {
    const { domain } = request.body;

    await writeDomain(domain);
    reply.code(201).send({ domain });
  },
});

fastify.route({
  method: "GET",
  url: "/proxy-config",
  handler: async (_, reply) => {
    const yaml = await getProxyConfigAsYaml();
    reply
      .header("content-type", 'application/x-yaml; charset="utf-8"')
      .send(yaml);
  },
});

// Run the server!
try {
  await fastify.listen({ port: 3000, host: "0.0.0.0" });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
