import { AbstractDynamicPlugin, Telemetry } from 'dyfactor';
import * as fs from 'fs';
import * as path from 'path';
import { preprocess, print, ASTPluginEnvironment, ASTPluginBuilder, Syntax, AST } from '@glimmer/syntax';
import { file, functionExpression } from 'babel-types';

const IS_THIS = '-dyfactor-is-this';
const IS_COMPONENT = '-dyfactor-is-component';
const IS_HELPER = '-dyfactor-is-helper';

const isThisHelper = `
  import { helper } from '@ember/component/helper';

  window.__dyfactor_telemetry = {};
  export default helper(function isThis([instance, str, value, file]) {
    if (typeof value !== 'object' && !(instance && instance.attrs && str in instance.attrs)) {
      if (window.__dyfactor_telemetry[file]) {
        if (!window.__dyfactor_telemetry[file].includes(str)) {
          window.__dyfactor_telemetry[file].push(str)
        }
      } else {
        window.__dyfactor_telemetry[file] = [str];
      }
    }

    return value;
  })
`;

const isComponentHelper = `
import {getOwner} from '@ember/application';
import Helper from '@ember/component/helper';
export default Helper.extend({
  compute([comp]) {
    let owner = getOwner(this);
    return !!owner.lookup(\`component:$\{comp}\`);
  }
});
`;

const isHelperHelper = `
import {getOwner} from '@ember/application';
import Helper from '@ember/component/helper';
export default Helper.extend({
  compute([comp]) {
    let owner = getOwner(this);
    return !!owner.lookup(\`helper:$\{comp}\`);
  }
});
`;

function wrapPotentialLocals(file: string) {
  return (env: ASTPluginEnvironment) => {
    let { syntax } = env;
    let { builders: b } = syntax;
    return {
      name: 'wrap-potential-helpers',
      visitor: {
        MustacheStatement(node) {
          if (isSynthetic(node) || isOutlet(node)) return node;

          let { params } = node;

          if (isComponentLike(node)) {
            if (hasNoArgs(node)) {
              return ifComponentBlock(syntax, node.path.original, file);
            }
          } else {
            if (hasNoArgs(node)) {
              return ifHelperBlock(syntax, node.path.original, file);
            }
          }

          if (hasParams(node)) {
            node.params = wrapParams(syntax, params, file);
          }

          return node;
        },

        HashPair(node) {
          if (node.value.type === 'PathExpression') {
            let params =  isThisParams(syntax, node.value, file);
            node.value = dyfactorSexpr(syntax, 'is-this', params);
          }

          return node;
        },

        SubExpression(node) {
          if (hasParams(node)) {
            node.params = wrapParams(syntax, node.params, file);
          }

          return node;
        }
      }
    }
  }
}

export default class extends AbstractDynamicPlugin {
  instrument() {
    fs.writeFileSync(`./app/helpers/${IS_THIS}.js`, isThisHelper);
    fs.writeFileSync(`./app/helpers/${IS_COMPONENT}.js`, isComponentHelper);
    fs.writeFileSync(`./app/helpers/${IS_HELPER}.js`, isHelperHelper);
    this.inputs.filter((input) => {
      return path.extname(input) === '.hbs';
    }).forEach((path) => {
      let content = fs.readFileSync(path, 'utf8');
      let ast = preprocess(content, {
        plugins: {
          ast: [wrapPotentialLocals(path)]
        }
      });

      let instrumented = print(ast);
      fs.writeFileSync(path, instrumented);
    });
  }

  modify(telemetry: Telemetry) {
    console.log(telemetry);
  }
}

function isPathExpression(param: AST.Node): param is AST.PathExpression {
  return param.type === 'PathExpression';
}

function wrapParams(syntax: Syntax, params: any[], fileName: string) {
  return params.map(param => {
    if (isPathExpression(param)) {
      return dyfactorSexpr(syntax, 'is-this', isThisParams(syntax, param.original, fileName));
    }
    return param;
  })
}

function dyfactorHelper(syntax: Syntax, helperName: string, params: any[]) {
  let { builders: b } = syntax;
  return b.mustache(b.path(`-dyfactor-${helperName}`), params);
}

function dyfactorSexpr(syntax: Syntax, helperName: string, params: any[]) {
  let { builders: b } = syntax;
  return b.sexpr(b.path(`-dyfactor-${helperName}`), params);
}

function ifBlock(syntax: Syntax, predicate: AST.SubExpression, conseq: AST.Program, alt: AST.Program) {
  let { builders: b } = syntax;
  return b.block(
    b.path('if'),
    [predicate],
    null,
    conseq,
    alt
  );
}

function isThisParams(syntax: Syntax, original: string, filePath: string) {
  let { builders: b } = syntax;
  return [b.path('this'), b.string(original), b.path(original), b.string(filePath)];
}

function ifHelperBlock(syntax: Syntax, original: string, filePath: string) {
  let { builders: b } = syntax;
  let predicate = dyfactorSexpr(syntax, 'is-helper', [b.string(original)]);
  let conseq = b.program([b.mustache(b.path(original))]);
  let isThisHelper = dyfactorHelper(syntax, 'is-this', isThisParams(syntax, original, filePath));
  let alt = b.program([isThisHelper]);
  return ifBlock(syntax, predicate, conseq, alt);
}

function ifComponentBlock(syntax: Syntax, original: string, filePath: string) {
  let { builders: b } = syntax;
  let predicate = dyfactorSexpr(syntax, 'is-component', [b.string(original)]);
  let componentHelper = b.mustache(b.path('component'), [b.string(original)]);
  let conseq = b.program([componentHelper]);
  let alt = b.program([ifHelperBlock(syntax, original, filePath)]);
  return ifBlock(syntax, predicate, conseq, alt);
}

function isComponentLike(node: AST.MustacheStatement) {
  return typeof node.path.original === 'string' && node.path.original.includes('-');
}

function isBuiltInComponent(str: string) {
  return str === 'input' || str === 'textarea'
}

function isSynthetic(node: AST.Node) {
  return node.loc.source === '(synthetic)';
}

function isOutlet(node: AST.MustacheStatement) {
  return node.path.original === 'outlet';
}

function hasNoArgs(node: AST.MustacheStatement) {
  return node.params.length === 0 && node.hash.pairs.length === 0;
}

function hasParams(node: AST.MustacheStatement) {
  return node.params.length > 0;
}