const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const matter = require('gray-matter');

const rootDir = './src'; // Replace with your actual directory
const outputFilePath = './src/admin/config.yml'; // Path to the master .yml file
const reusableFields = ['button']; // List of reusable field names
const optionFields = ['style', 'theme']; // List of fields that should be select widgets

let reusableFieldDefinitions = {};
let optionFieldValues = {};

// Recursively get all .md files in the directory
const getAllMarkdownFiles = (dir) => {
  return fs.readdirSync(dir).reduce((acc, file) => {
    const fullPath = path.join(dir, file);
    return fs.statSync(fullPath).isDirectory()
      ? acc.concat(getAllMarkdownFiles(fullPath))
      : (path.extname(fullPath) === '.md' ? acc.concat(fullPath) : acc);
  }, []);
};

// Aggregate blocks by type from each .md file
const processMarkdownFiles = (mdFiles) => {
  return mdFiles.reduce((aggregatedBlocks, filePath) => {
    const blocks = matter(fs.readFileSync(filePath, 'utf8')).data.blocks;
    if (!Array.isArray(blocks)) {
      console.log(`No 'blocks' field in ${filePath}`);
      return aggregatedBlocks;
    }

    blocks.forEach(block => {
      const blockType = block.type;

      if (!aggregatedBlocks[blockType]) {
        aggregatedBlocks[blockType] = {
          label: capitalizeFirstLetter(blockType),
          name: blockType,
          widget: 'object',
          fields: formatBlock(block)
        };
      }

      aggregatedBlocks[blockType].fields = mergeFields(aggregatedBlocks[blockType].fields, formatBlock(block));
    });

    return aggregatedBlocks;
  }, {});
};

// Format block fields to CMS configuration
const formatBlock = (block) => {
  const fields = [];
  let titleField = null;

  Object.entries(block).forEach(([key, value]) => {
    if (reusableFields.includes(key) && !reusableFieldDefinitions[key]) {
      reusableFieldDefinitions[key] = {
        label: capitalizeFirstLetter(key),
        name: key,
        widget: 'object',
        fields: formatBlock(value)
      };
    }

    if (reusableFields.includes(key)) {
      fields.push(`*${key.toUpperCase()}`);
    } else if (optionFields.includes(key)) {
      collectOptionFieldValues(block.type, key, value);

      fields.push({
        label: capitalizeFirstLetter(key),
        name: key,
        widget: 'select',
        options: [] // Placeholder; will be filled later
      });
    } else if (key === 'image' && value.startsWith('/uploads/')) {
      fields.push({ label: 'Image', name: 'image', widget: 'image' });
    } else if (Array.isArray(value)) {
      fields.push({
        label: capitalizeFirstLetter(key),
        name: key,
        widget: 'list',
        fields: formatFields(value)
      });
    } else if (typeof value === 'object') {
      fields.push({
        label: capitalizeFirstLetter(key),
        name: key,
        widget: 'object',
        fields: formatBlock(value)
      });
    } else if (key !== 'type') {
      const field = { label: capitalizeFirstLetter(key), name: key, widget: determineWidgetType(value) };
      fields.push(field);
      if (key === 'title') titleField = field;
    }
  });

  if (titleField) {
    fields.splice(fields.indexOf(titleField), 1);
    fields.unshift(titleField);
  }

  return fields;
};

// Diff arrays
const diffArrays = (arr1, arr2) => [...arr1.filter(item => !arr2.includes(item)), ...arr2.filter(item => !arr1.includes(item))];

// Merge fields from different blocks of the same type
const mergeFields = (targetFields, newFields) => {
  const targetSafeFields = (targetFields ?? []);
  const newSafeFields = (newFields ?? []);

  const fieldMap = new Map();

  targetSafeFields.forEach(field => {
    fieldMap.set(field.name, field);
  });

  newSafeFields.forEach(field => {
    fieldMap.set(field.name, field);
  });

  const merged = Array.from(fieldMap.values());

  const existingFieldNames = targetSafeFields.map(field => field.name);
  const newFieldNames = newSafeFields.map(field => field.name);
  const diff = diffArrays(newFieldNames, existingFieldNames);

  return merged.map(item => {
    return typeof item === 'object' ? {
      ...item,
      required: !diff.includes(item.name)
    } : item;
  });
};

// Collect unique option values for select fields
const collectOptionFieldValues = (blockType, fieldName, fieldValue) => {
  const name = `${blockType}-${fieldName}`;

  if (!optionFieldValues[name]) {
    optionFieldValues[name] = new Set();
  }

  optionFieldValues[name].add(fieldValue);
};

// Determine the widget type based on the content
const determineWidgetType = (value) => {
  if (typeof value === 'string' && value.startsWith('/uploads/')) return 'image';
  if (typeof value === 'string' && value.length > 59) return 'markdown';
  return 'string';
};

// Format nested fields dynamically
const formatFields = (fieldsArray) => {
  if (!Array.isArray(fieldsArray) || fieldsArray.length === 0) return [];
  return Object.entries(fieldsArray[0]).map(([key, value]) => ({
    label: capitalizeFirstLetter(key),
    name: key,
    widget: determineWidgetType(value)
  }));
};

// Capitalize the first letter of a string
const capitalizeFirstLetter = (string) => string.charAt(0).toUpperCase() + string.slice(1);

// Write the aggregated blocks to a master .yml file
const writeMasterYml = (blocks) => {
  // Add options to select fields
  for (const block of Object.values(blocks)) {
    (block.fields ?? []).forEach(field => {
      if (field.widget === 'select') {
        const optionKey = `${block.name}-${field.name}`;
        field.options = Array.from(optionFieldValues[optionKey] || []);
      }
    });
  }

  // Create reusable fields YAML with anchors
  const reusableFieldsYaml = Object.entries(reusableFieldDefinitions)
    .map(([key, value]) => yaml.dump({ [key]: value }, { noRefs: true })
      .replace(new RegExp(`^${key}:`, 'm'), `${key}: &${key.toUpperCase()}`))
      .join('\n');

  // Generate YAML for blocks with references
  const blocksYaml = yaml.dump(Object.values(blocks), { noRefs: true });

  const output = `
local_backend: true
backend:
  name: 'github'
  repo: 'Gittings-Studio/website'
  branch: 'master'

media_folder: 'src/uploads'
public_folder: '/uploads'

${reusableFieldsYaml.trim()}

blocks: &BLOCKS
  label: Blocks
  name: blocks
  widget: list
  types:
    ${blocksYaml
      .replace(/^/gm, '    ')
      .trim()
      .replace(/'\*([A-Z]+)'/g, '*$1')}

collections:
  - label: 'Pages'
    name: 'pages'
    folder: 'src'
    identifier_field: 'title'
    create: true
    extension: 'md'
    meta: { path: { widget: string, label: 'Path', index_file: 'index' } }
    nested:
      depth: 4
      summary: '{{title}}'
    fields:
      - { label: 'Layout', name: 'layout', widget: 'hidden', default: 'layouts/page.njk' }
      - { label: 'Title', name: 'title', widget: 'string' }
      - *BLOCKS
`.trim();

  fs.writeFileSync(outputFilePath, output, 'utf8');
  console.log(`Generated ${outputFilePath}`);
};

// Main function to execute the script
const main = () => {
  const mdFiles = getAllMarkdownFiles(rootDir);
  const aggregatedBlocks = processMarkdownFiles(mdFiles);
  writeMasterYml(aggregatedBlocks);
};

main();