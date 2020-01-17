module.exports = {
  presets: [
    ['@babel/preset-typescript', {allExtensions: true}],
    [
      '@babel/preset-env',
      {
        targets: {
          node: '6'
        },
        loose: true
      }
    ]
  ],
  plugins: [
    [
      'babel-plugin-module-name-mapper',
      {
        moduleNameMapper: {
          '^src/(.*)': '<rootDir>/src/$1'
        }
      }
    ],
    '@babel/plugin-proposal-class-properties',
    '@babel/plugin-proposal-optional-chaining',
    '@babel/plugin-proposal-object-rest-spread',
    '@babel/plugin-transform-runtime'
  ]
};
