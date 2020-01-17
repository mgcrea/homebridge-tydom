# Homebridge Tydom Plugin

[![npm version](https://img.shields.io/npm/v/homebridge-tydom.svg)](https://github.com/mgcrea/homebridge-tydom/releases)
[![license](https://img.shields.io/github/license/mgcrea/homebridge-tydom.svg?style=flat)](https://tldrlegal.com/license/mit-license)
[![build status](https://travis-ci.com/mgcrea/homebridge-tydom.svg?branch=master)](https://travis-ci.com/mgcrea/homebridge-tydom)
[![dependencies status](https://david-dm.org/mgcrea/homebridge-tydom/status.svg)](https://david-dm.org/mgcrea/homebridge-tydom)
[![devDependencies status](https://david-dm.org/mgcrea/homebridge-tydom/dev-status.svg)](https://david-dm.org/mgcrea/homebridge-tydom?type=dev)
[![coverage](https://codecov.io/gh/mgcrea/homebridge-tydom/branch/master/graph/badge.svg)](https://codecov.io/gh/mgcrea/homebridge-tydom)

[Homebridge](https://homebridge.io/) plugin to easily manage [Tydom hardware](https://www.deltadore.fr/domotique/pilotage-maison-connectee/box-domotique/tydom-2-0-ref-6414118) by [Delta Dore](https://www.deltadore.fr/) from [Apple HomeKit](https://www.apple.com/ios/home/).

- Rely on [node-tydom-client](https://github.com/mgcrea/node-tydom-client) to communicate with Tydom bridge.

- Built with [TypeScript](https://www.typescriptlang.org/) for static type checking with exported types along the library.

### Available scripts

| **Script**    | **Description**              |
| ------------- | ---------------------------- |
| start         | alias to `spec:watch`        |
| test          | Run all tests                |
| spec          | Run unit tests               |
| spec:coverage | Run unit tests with coverage |
| spec:watch    | Watch unit tests             |
| lint          | Run eslint static tests      |
| pretty        | Run prettier static tests    |
| build         | Compile the library          |
| build:watch   | Watch compilation            |

## Authors

**Olivier Louvignes**

- http://olouv.com
- http://github.com/mgcrea

## License

```
The MIT License

Copyright (c) 2020 Olivier Louvignes <olivier@mgcrea.io>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
