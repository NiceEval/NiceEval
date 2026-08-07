// 仓库外 NodeNext CJS consumer：只经包名与 exports require 根入口及全部公开 runtime
// subpath，不引用候选包内部声明路径（T6.2.2 Journey B）。列表与安装后 exports 的
// object runtime subpath 集合由 package.test.ts 的防漂移守护核对。

import niceeval = require("niceeval");
import sandbox = require("niceeval/sandbox");
import sandboxE2bTemplate = require("niceeval/sandbox/e2b-template");
import adapter = require("niceeval/adapter");
import adapterOtel = require("niceeval/adapter/otel");
import expect = require("niceeval/expect");
import reporters = require("niceeval/reporters");
import loaders = require("niceeval/loaders");
import record = require("niceeval/record");
import sample = require("niceeval/sample");
import report = require("niceeval/report");
import reportReact = require("niceeval/report/react");
import reportBuiltIn = require("niceeval/report/built-in");
import reportExtension = require("niceeval/report/extension");

export = {
  niceeval,
  sandbox,
  sandboxE2bTemplate,
  adapter,
  adapterOtel,
  expect,
  reporters,
  loaders,
  record,
  sample,
  report,
  reportReact,
  reportBuiltIn,
  reportExtension,
};
