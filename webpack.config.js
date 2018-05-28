const CleanWebpackPlugin = require('clean-webpack-plugin'); // installed via npm
// const path = require('path');
// const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  // node: {
  //   fs: 'empty'
  // },
  // entry: ['whatwg-fetch', 'babel-polyfill', `./src/index.js`],
  entry: ['node-fetch', 'babel-polyfill', `./src/index.js`],
  // entry: [`./src/index.js`],
  output: {
    path: __dirname,
    filename: 'build/[name].js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        // exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            // cacheDirectory: false,
            // compact: false,
            presets: [
              'env',
              'stage-0'
            ]
          }
        }
      }
      // ,
      // {
      //     test: /\.html$/,
      //     use: [{
      //         loader: "html-loader"
      //     }]
      // },
      // {
      //     test: /\.scss$/,
      //     use: [{
      //         loader: "style-loader" // creates style nodes from JS strings
      //     }, {
      //         loader: "css-loader" // translates CSS into CommonJS
      //     }, {
      //         loader: "sass-loader"
      //     }]
      // }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(['build'])
    // ,
    // new HtmlWebpackPlugin({
    //     inject: true,
    //     chunks: [NOTES_AND_ACTIVITIES_WEBPART],
    //     filename: `dist/webParts/${NOTES_AND_ACTIVITIES_WEBPART}/${NOTES_AND_ACTIVITIES_WEBPART}.html`,
    //     template: `./webParts/${NOTES_AND_ACTIVITIES_WEBPART}/${NOTES_AND_ACTIVITIES_WEBPART}.html`
    // })
  ]
};
