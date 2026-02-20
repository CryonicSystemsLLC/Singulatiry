/**
 * Prisma Schema Parser
 *
 * Parses Prisma schema files into structured data for analysis and manipulation.
 */

export interface PrismaField {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  default?: string;
  relation?: {
    name?: string;
    fields?: string[];
    references?: string[];
    onDelete?: string;
    onUpdate?: string;
  };
  attributes: string[];
}

export interface PrismaModel {
  name: string;
  fields: PrismaField[];
  attributes: string[];
  documentation?: string;
}

export interface PrismaEnum {
  name: string;
  values: string[];
  documentation?: string;
}

export interface PrismaDatasource {
  name: string;
  provider: string;
  url: string;
  directUrl?: string;
}

export interface PrismaGenerator {
  name: string;
  provider: string;
  output?: string;
  previewFeatures?: string[];
}

export interface ParsedSchema {
  datasources: PrismaDatasource[];
  generators: PrismaGenerator[];
  models: PrismaModel[];
  enums: PrismaEnum[];
  raw: string;
}

/**
 * Parse a Prisma schema file
 */
export function parseSchema(content: string): ParsedSchema {
  const result: ParsedSchema = {
    datasources: [],
    generators: [],
    models: [],
    enums: [],
    raw: content
  };

  // Remove comments for parsing (but keep for documentation)
  const lines = content.split('\n');
  let currentBlock: 'none' | 'datasource' | 'generator' | 'model' | 'enum' = 'none';
  let currentItem: any = null;
  let braceDepth = 0;
  let pendingDoc = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      pendingDoc = '';
      continue;
    }

    // Capture documentation comments
    if (trimmed.startsWith('///')) {
      pendingDoc += trimmed.slice(3).trim() + '\n';
      continue;
    }

    // Skip regular comments
    if (trimmed.startsWith('//')) {
      continue;
    }

    // Detect block starts
    if (trimmed.startsWith('datasource ')) {
      const name = trimmed.match(/datasource\s+(\w+)/)?.[1] || 'db';
      currentBlock = 'datasource';
      currentItem = { name, provider: '', url: '' };
      braceDepth = 1;
      continue;
    }

    if (trimmed.startsWith('generator ')) {
      const name = trimmed.match(/generator\s+(\w+)/)?.[1] || 'client';
      currentBlock = 'generator';
      currentItem = { name, provider: '' };
      braceDepth = 1;
      continue;
    }

    if (trimmed.startsWith('model ')) {
      const name = trimmed.match(/model\s+(\w+)/)?.[1] || 'Unknown';
      currentBlock = 'model';
      currentItem = {
        name,
        fields: [],
        attributes: [],
        documentation: pendingDoc.trim() || undefined
      };
      pendingDoc = '';
      braceDepth = 1;
      continue;
    }

    if (trimmed.startsWith('enum ')) {
      const name = trimmed.match(/enum\s+(\w+)/)?.[1] || 'Unknown';
      currentBlock = 'enum';
      currentItem = {
        name,
        values: [],
        documentation: pendingDoc.trim() || undefined
      };
      pendingDoc = '';
      braceDepth = 1;
      continue;
    }

    // Track brace depth
    if (trimmed.includes('{')) braceDepth++;
    if (trimmed.includes('}')) braceDepth--;

    // Block ended
    if (braceDepth === 0 && currentBlock !== 'none') {
      switch (currentBlock) {
        case 'datasource':
          result.datasources.push(currentItem as PrismaDatasource);
          break;
        case 'generator':
          result.generators.push(currentItem as PrismaGenerator);
          break;
        case 'model':
          result.models.push(currentItem as PrismaModel);
          break;
        case 'enum':
          result.enums.push(currentItem as PrismaEnum);
          break;
      }
      currentBlock = 'none';
      currentItem = null;
      continue;
    }

    // Parse block contents
    if (currentBlock === 'datasource' && currentItem) {
      const providerMatch = trimmed.match(/provider\s*=\s*"(\w+)"/);
      if (providerMatch) currentItem.provider = providerMatch[1];

      const urlMatch = trimmed.match(/url\s*=\s*(.+)/);
      if (urlMatch) currentItem.url = urlMatch[1].replace(/"/g, '').trim();

      const directUrlMatch = trimmed.match(/directUrl\s*=\s*(.+)/);
      if (directUrlMatch) currentItem.directUrl = directUrlMatch[1].replace(/"/g, '').trim();
    }

    if (currentBlock === 'generator' && currentItem) {
      const providerMatch = trimmed.match(/provider\s*=\s*"([^"]+)"/);
      if (providerMatch) currentItem.provider = providerMatch[1];

      const outputMatch = trimmed.match(/output\s*=\s*"([^"]+)"/);
      if (outputMatch) currentItem.output = outputMatch[1];

      const featuresMatch = trimmed.match(/previewFeatures\s*=\s*\[([^\]]+)\]/);
      if (featuresMatch) {
        currentItem.previewFeatures = featuresMatch[1]
          .split(',')
          .map(f => f.trim().replace(/"/g, ''));
      }
    }

    if (currentBlock === 'model' && currentItem) {
      // Model-level attribute (@@)
      if (trimmed.startsWith('@@')) {
        currentItem.attributes.push(trimmed);
        continue;
      }

      // Parse field
      const field = parseField(trimmed, pendingDoc);
      if (field) {
        currentItem.fields.push(field);
      }
      pendingDoc = '';
    }

    if (currentBlock === 'enum' && currentItem) {
      // Enum value
      if (!trimmed.startsWith('}') && !trimmed.includes('=')) {
        currentItem.values.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Parse a single field definition
 */
function parseField(line: string, _documentation?: string): PrismaField | null {
  // Match: fieldName Type? @attribute @attribute
  const match = line.match(/^(\w+)\s+(\w+)(\[\])?\??/);
  if (!match) return null;

  const [, name, type, arrayMarker] = match;
  const isOptional = line.includes('?');
  const isArray = !!arrayMarker;

  // Parse attributes
  const attributes: string[] = [];
  const attrMatches = line.matchAll(/@(\w+)(\([^)]*\))?/g);
  for (const m of attrMatches) {
    attributes.push(m[0]);
  }

  // Check for common attributes
  const isId = attributes.some(a => a.startsWith('@id'));
  const isUnique = attributes.some(a => a.startsWith('@unique'));

  // Parse default value
  const defaultMatch = line.match(/@default\(([^)]+)\)/);
  const defaultValue = defaultMatch ? defaultMatch[1] : undefined;

  // Parse relation
  let relation: PrismaField['relation'] | undefined;
  const relationMatch = line.match(/@relation\(([^)]+)\)/);
  if (relationMatch) {
    relation = {};
    const relContent = relationMatch[1];

    const nameMatch = relContent.match(/name:\s*"([^"]+)"/);
    if (nameMatch) relation.name = nameMatch[1];

    const fieldsMatch = relContent.match(/fields:\s*\[([^\]]+)\]/);
    if (fieldsMatch) {
      relation.fields = fieldsMatch[1].split(',').map(f => f.trim());
    }

    const refsMatch = relContent.match(/references:\s*\[([^\]]+)\]/);
    if (refsMatch) {
      relation.references = refsMatch[1].split(',').map(r => r.trim());
    }

    const onDeleteMatch = relContent.match(/onDelete:\s*(\w+)/);
    if (onDeleteMatch) relation.onDelete = onDeleteMatch[1];

    const onUpdateMatch = relContent.match(/onUpdate:\s*(\w+)/);
    if (onUpdateMatch) relation.onUpdate = onUpdateMatch[1];
  }

  return {
    name,
    type,
    isArray,
    isOptional,
    isId,
    isUnique,
    default: defaultValue,
    relation,
    attributes
  };
}

/**
 * Validate a Prisma schema
 */
export interface ValidationError {
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

export function validateSchema(content: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const parsed = parseSchema(content);

  // Check for datasource
  if (parsed.datasources.length === 0) {
    errors.push({
      message: 'No datasource defined',
      severity: 'error'
    });
  }

  // Check for generator
  if (parsed.generators.length === 0) {
    errors.push({
      message: 'No generator defined',
      severity: 'warning'
    });
  }

  // Check for models
  if (parsed.models.length === 0) {
    errors.push({
      message: 'No models defined',
      severity: 'warning'
    });
  }

  // Validate each model
  for (const model of parsed.models) {
    // Check for id field
    const hasId = model.fields.some(f => f.isId);
    if (!hasId) {
      errors.push({
        message: `Model '${model.name}' has no @id field`,
        severity: 'error'
      });
    }

    // Check for relation integrity
    for (const field of model.fields) {
      if (field.relation) {
        // Check if referenced model exists
        const refType = field.type;
        const refModel = parsed.models.find(m => m.name === refType);
        if (!refModel && !parsed.enums.find(e => e.name === refType)) {
          errors.push({
            message: `Model '${model.name}' references unknown type '${refType}'`,
            severity: 'error'
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Generate a schema string from parsed data
 */
export function generateSchema(schema: ParsedSchema): string {
  const lines: string[] = [];

  // Generators
  for (const gen of schema.generators) {
    lines.push(`generator ${gen.name} {`);
    lines.push(`  provider = "${gen.provider}"`);
    if (gen.output) {
      lines.push(`  output   = "${gen.output}"`);
    }
    if (gen.previewFeatures?.length) {
      lines.push(`  previewFeatures = [${gen.previewFeatures.map(f => `"${f}"`).join(', ')}]`);
    }
    lines.push('}');
    lines.push('');
  }

  // Datasources
  for (const ds of schema.datasources) {
    lines.push(`datasource ${ds.name} {`);
    lines.push(`  provider = "${ds.provider}"`);
    lines.push(`  url      = ${ds.url.startsWith('env(') ? ds.url : `"${ds.url}"`}`);
    if (ds.directUrl) {
      lines.push(`  directUrl = ${ds.directUrl.startsWith('env(') ? ds.directUrl : `"${ds.directUrl}"`}`);
    }
    lines.push('}');
    lines.push('');
  }

  // Enums
  for (const en of schema.enums) {
    if (en.documentation) {
      for (const doc of en.documentation.split('\n')) {
        if (doc.trim()) lines.push(`/// ${doc}`);
      }
    }
    lines.push(`enum ${en.name} {`);
    for (const val of en.values) {
      lines.push(`  ${val}`);
    }
    lines.push('}');
    lines.push('');
  }

  // Models
  for (const model of schema.models) {
    if (model.documentation) {
      for (const doc of model.documentation.split('\n')) {
        if (doc.trim()) lines.push(`/// ${doc}`);
      }
    }
    lines.push(`model ${model.name} {`);

    for (const field of model.fields) {
      let fieldLine = `  ${field.name.padEnd(15)} ${field.type}`;
      if (field.isArray) fieldLine += '[]';
      if (field.isOptional) fieldLine += '?';

      if (field.attributes.length > 0) {
        fieldLine += ' ' + field.attributes.join(' ');
      }

      lines.push(fieldLine);
    }

    for (const attr of model.attributes) {
      lines.push(`  ${attr}`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get model dependencies (which models reference which)
 */
export function getModelDependencies(schema: ParsedSchema): Map<string, string[]> {
  const deps = new Map<string, string[]>();

  for (const model of schema.models) {
    const modelDeps: string[] = [];

    for (const field of model.fields) {
      // Check if field type is another model
      const refModel = schema.models.find(m => m.name === field.type);
      if (refModel && !modelDeps.includes(field.type)) {
        modelDeps.push(field.type);
      }
    }

    deps.set(model.name, modelDeps);
  }

  return deps;
}

/**
 * Suggest a migration name based on schema changes
 */
export function suggestMigrationName(
  oldSchema: ParsedSchema,
  newSchema: ParsedSchema
): string {
  const oldModels = new Set(oldSchema.models.map(m => m.name));
  const newModels = new Set(newSchema.models.map(m => m.name));

  const addedModels = [...newModels].filter(m => !oldModels.has(m));
  const removedModels = [...oldModels].filter(m => !newModels.has(m));

  if (addedModels.length > 0 && removedModels.length === 0) {
    return `add_${addedModels.join('_and_').toLowerCase()}`;
  }

  if (removedModels.length > 0 && addedModels.length === 0) {
    return `remove_${removedModels.join('_and_').toLowerCase()}`;
  }

  if (addedModels.length > 0 && removedModels.length > 0) {
    return `update_${addedModels[0].toLowerCase()}_and_more`;
  }

  // Check for field changes
  for (const newModel of newSchema.models) {
    const oldModel = oldSchema.models.find(m => m.name === newModel.name);
    if (oldModel) {
      const oldFields = new Set(oldModel.fields.map(f => f.name));
      const newFields = new Set(newModel.fields.map(f => f.name));

      const addedFields = [...newFields].filter(f => !oldFields.has(f));
      if (addedFields.length > 0) {
        return `add_${addedFields[0]}_to_${newModel.name}`.toLowerCase();
      }
    }
  }

  return 'update_schema';
}

export default {
  parseSchema,
  validateSchema,
  generateSchema,
  getModelDependencies,
  suggestMigrationName
};
