import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverPath = resolve(root, "backend/internal/httpapi/server.go");
const openapiPath = resolve(root, "docs/openapi.yaml");
const generatedPath = resolve(root, "packages/api-client/src/generated.ts");

const server = readFileSync(serverPath, "utf8");
const openapi = readFileSync(openapiPath, "utf8");
const generated = readFileSync(generatedPath, "utf8");

const ignoredBackendRoutes = new Set([
  "GET /health",
  "GET /live",
  "GET /media/*",
  "GET /ready",
]);

const backendRoutes = new Set();
const routePattern = /\br\.(Get|Post|Put|Delete)\("([^"]+)"/g;
let routeMatch;
while ((routeMatch = routePattern.exec(server)) !== null) {
  const method = routeMatch[1].toUpperCase();
  const path = routeMatch[2];
  const route = `${method} ${path}`;
  if (!ignoredBackendRoutes.has(route)) {
    backendRoutes.add(route);
  }
}

const openapiRoutes = new Set();
const lines = openapi.split(/\r?\n/);
let currentPath = "";
for (const line of lines) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1];
    continue;
  }
  const methodMatch = line.match(/^    (get|post|put|delete):\s*$/i);
  if (currentPath && methodMatch) {
    openapiRoutes.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
  }
}

const missingFromOpenAPI = [...backendRoutes]
  .filter((route) => !openapiRoutes.has(route))
  .sort();
const staleInOpenAPI = [...openapiRoutes]
  .filter((route) => !backendRoutes.has(route))
  .sort();
const openapiSchemas = collectOpenAPIObjectSchemas(lines);
const missingGeneratedSchemas = [...openapiSchemas.keys()]
  .filter((name) => !new RegExp(`export\\s+(interface|type)\\s+${name}\\b`).test(generated))
  .sort();
const generatedInterfaces = collectGeneratedInterfaces(generated);
const schemaMismatches = compareOpenAPISchemasToGenerated(openapiSchemas, generatedInterfaces);

if (missingFromOpenAPI.length || staleInOpenAPI.length || missingGeneratedSchemas.length || schemaMismatches.length) {
  if (missingFromOpenAPI.length) {
    console.error("Routes present in backend but missing in docs/openapi.yaml:");
    for (const route of missingFromOpenAPI) {
      console.error(`  - ${route}`);
    }
  }
  if (staleInOpenAPI.length) {
    console.error("Routes present in docs/openapi.yaml but not found in backend:");
    for (const route of staleInOpenAPI) {
      console.error(`  - ${route}`);
    }
  }
  if (missingGeneratedSchemas.length) {
    console.error("Schemas present in docs/openapi.yaml but missing in packages/api-client/src/generated.ts:");
    for (const schema of missingGeneratedSchemas) {
      console.error(`  - ${schema}`);
    }
  }
  if (schemaMismatches.length) {
    console.error("OpenAPI component schemas differ from packages/api-client/src/generated.ts:");
    for (const mismatch of schemaMismatches) {
      console.error(`  - ${mismatch}`);
    }
  }
  process.exit(1);
}

console.log(`OpenAPI route coverage OK (${backendRoutes.size} backend routes); generated schema field coverage OK (${openapiSchemas.size} schemas).`);

function collectOpenAPIObjectSchemas(lines) {
  const schemas = new Map();
  let inSchemas = false;
  let currentSchema = null;
  let currentProperty = null;
  let inProperties = false;
  for (const line of lines) {
    if (line.match(/^  schemas:\s*$/)) {
      inSchemas = true;
      continue;
    }
    if (inSchemas && line.match(/^  [A-Za-z][A-Za-z0-9_-]*:\s*$/)) {
      break;
    }
    if (!inSchemas) continue;
    const schemaMatch = line.match(/^    ([A-Z][A-Za-z0-9]+):\s*$/);
    if (schemaMatch) {
      currentSchema = {
        name: schemaMatch[1],
        type: "",
        required: new Set(),
        properties: new Map(),
      };
      schemas.set(currentSchema.name, currentSchema);
      currentProperty = null;
      inProperties = false;
      continue;
    }
    if (!currentSchema) continue;

    const schemaTypeMatch = line.match(/^      type:\s*([A-Za-z]+)\s*$/);
    if (schemaTypeMatch) {
      currentSchema.type = schemaTypeMatch[1];
      continue;
    }

    const requiredMatch = line.match(/^      required:\s*\[([^\]]*)]\s*$/);
    if (requiredMatch) {
      currentSchema.required = new Set(requiredMatch[1].split(",").map((value) => value.trim()).filter(Boolean));
      continue;
    }

    if (line.match(/^      properties:\s*$/)) {
      inProperties = true;
      currentProperty = null;
      continue;
    }

    if (inProperties) {
      const propertyMatch = line.match(/^        ([A-Za-z_][A-Za-z0-9_]*):\s*$/);
      if (propertyMatch) {
        currentProperty = {
          name: propertyMatch[1],
          type: "",
          enumValues: [],
        };
        currentSchema.properties.set(currentProperty.name, currentProperty);
        continue;
      }
      const propertyTypeMatch = line.match(/^          type:\s*([A-Za-z]+)\s*$/);
      if (currentProperty && propertyTypeMatch) {
        currentProperty.type = propertyTypeMatch[1];
        continue;
      }
      const enumMatch = line.match(/^          enum:\s*\[([^\]]*)]\s*$/);
      if (currentProperty && enumMatch) {
        currentProperty.enumValues = enumMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
        continue;
      }
    }
  }
  return schemas;
}

function collectGeneratedInterfaces(source) {
  const interfaces = new Map();
  const interfacePattern = /^export interface ([A-Z][A-Za-z0-9]+) \{\n([\s\S]*?)^}/gm;
  let interfaceMatch;
  while ((interfaceMatch = interfacePattern.exec(source)) !== null) {
    const properties = new Map();
    const body = interfaceMatch[2];
    const propertyPattern = /^  ([A-Za-z_][A-Za-z0-9_]*)(\?)?: ([^;]+);$/gm;
    let propertyMatch;
    while ((propertyMatch = propertyPattern.exec(body)) !== null) {
      properties.set(propertyMatch[1], {
        optional: propertyMatch[2] === "?",
        type: propertyMatch[3],
      });
    }
    interfaces.set(interfaceMatch[1], properties);
  }
  return interfaces;
}

function compareOpenAPISchemasToGenerated(schemas, interfaces) {
  const mismatches = [];
  for (const [schemaName, schema] of schemas) {
    if (schema.type !== "object") continue;
    const generatedProperties = interfaces.get(schemaName);
    if (!generatedProperties) continue;

    for (const [propertyName, property] of schema.properties) {
      const generatedProperty = generatedProperties.get(propertyName);
      if (!generatedProperty) {
        mismatches.push(`${schemaName}.${propertyName} is missing in generated TypeScript interface`);
        continue;
      }
      const required = schema.required.has(propertyName);
      if (required && generatedProperty.optional) {
        mismatches.push(`${schemaName}.${propertyName} is required in OpenAPI but optional in generated TypeScript`);
      }
      if (!required && !generatedProperty.optional) {
        mismatches.push(`${schemaName}.${propertyName} is optional in OpenAPI but required in generated TypeScript`);
      }
      const typeMismatch = compareGeneratedPropertyType(schemaName, property, generatedProperty.type);
      if (typeMismatch) mismatches.push(typeMismatch);
    }

    for (const propertyName of generatedProperties.keys()) {
      if (!schema.properties.has(propertyName)) {
        mismatches.push(`${schemaName}.${propertyName} exists in generated TypeScript but not in OpenAPI schema`);
      }
    }
  }
  return mismatches.sort();
}

function compareGeneratedPropertyType(schemaName, property, generatedType) {
  if (property.enumValues.length > 0) {
    const missingEnums = property.enumValues.filter((value) => !generatedType.includes(`"${value}"`));
    if (missingEnums.length > 0) {
      return `${schemaName}.${property.name} is missing enum values in generated TypeScript: ${missingEnums.join(", ")}`;
    }
    return "";
  }

  const expectedType = {
    boolean: "boolean",
    integer: "number",
    number: "number",
    string: "string",
  }[property.type];
  if (expectedType && generatedType !== expectedType) {
    return `${schemaName}.${property.name} type mismatch: OpenAPI ${property.type}, generated ${generatedType}`;
  }
  return "";
}
