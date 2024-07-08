module.exports = (eleventyConfig) => {
  // Pass through
  eleventyConfig.addPassthroughCopy('./src/admin/config.yml');

  return {
    dir: {
      input: 'src',
      output: '_site',
    }
  };
};
