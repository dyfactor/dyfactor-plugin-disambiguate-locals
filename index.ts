import { AbstractDynamicPlugin, Telemetry, DYFACTOR_GLOBAL } from 'dyfactor';
import * as fs from 'fs';
import * as path from 'path';
import { ASTPluginEnvironment, ASTPluginBuilder, Syntax, AST, preprocess, print } from '@glimmer/syntax';
import { file, functionExpression } from 'babel-types';
import * as tRecast from 'ember-template-recast';

const isThisHelper = `
  import { helper } from '@ember/component/helper';

  if (!${DYFACTOR_GLOBAL}) {
    ${DYFACTOR_GLOBAL} = {};
  }

  export default helper(function isThis([instance, str, value, file]) {
    let [ key ] = str.split('.');
    if (!(instance && instance.attrs && key in instance.attrs)) {
      if (${DYFACTOR_GLOBAL}[file]) {
        if (!${DYFACTOR_GLOBAL}[file].includes(str)) {
          ${DYFACTOR_GLOBAL}[file].push(str, key);
        }
      } else {
        ${DYFACTOR_GLOBAL}[file] = [str];
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

export function wrapPotentialLocals(filePath: string) {
  return (env: ASTPluginEnvironment) => {
    let { syntax } = env;
    let { builders: b } = syntax;
    let blockParamsStack = [];
    let inHTMLPosition = false;

    function isBlockParam(original: string) {
      return blockParamsStack.indexOf(original) > -1;
    }

    function wrapParams(params: any[], fileName: string) {
      return params.map(param => {
        if (isPathExpression(param) && !isBlockParam(param.original)) {
          return dyfactorSexpr('is-this', isThisParams(param.original, fileName));
        }
        return param;
      })
    }

    function dyfactorHelper(helperName: string, params: any[]) {
      return b.mustache(b.path(`-dyfactor-${helperName}`), params);
    }

    function dyfactorSexpr(helperName: string, params: any[]) {
      return b.sexpr(b.path(`-dyfactor-${helperName}`), params);
    }

    function ifBlock(predicate: AST.SubExpression, conseq: AST.Program, alt: AST.Program) {
      return b.block(
        b.path('if'),
        [predicate],
        null,
        conseq,
        alt
      );
    }

    function isThisParams(original: string, filePath: string) {
      return [b.path('this'), b.string(original), b.path(original), b.string(filePath)];
    }

    function ifHelperBlock(original: string, filePath: string) {
      let predicate = dyfactorSexpr('is-helper', [b.string(original)]);
      let conseq = b.program([b.mustache(b.path(original))]);
      let isThisHelper = dyfactorHelper('is-this', isThisParams(original, filePath));
      let alt = b.program([isThisHelper]);
      return ifBlock(predicate, conseq, alt);
    }

    function ifComponent(original: string, filePath: string) {
      let predicate = dyfactorSexpr('is-component', [b.string(original)]);
      let componentHelper = b.mustache(b.path('component'), [b.string(original)]);
      let conseq = b.program([componentHelper]);
      let alt = b.program([ifHelperBlock(original, filePath)]);
      return ifBlock(predicate, conseq, alt);
    }

    return {
      name: 'disambiguate-locals',
      visitor: {
        Program: {
          enter(node) {
            if (hasBlockParams(node)) {
              blockParamsStack.push(...node.blockParams);
            }
          },
          exit(node) {
            if (hasBlockParams(node)) {
              blockParamsStack = blockParamsStack.slice(0, node.blockParams.length - 1);
            }
          }
        },

        BlockStatement(node) {
          if (isSynthetic(node)) return node;
          node.params = node.params.map(param => {
            if (isPathExpression(param) && !isBlockParam(param.original)) {
              return dyfactorSexpr('is-this', isThisParams(param.original, filePath))
            }

            return param;
          });
        },
        MustacheStatement(node) {
          if (isSynthetic(node) || isOutlet(node) || isBlockParam(node.path.original)) return node;

          let { params } = node;

          if (isComponentLike(node)) {
            if (hasNoArgs(node)) {
              return ifComponent(node.path.original, filePath);
            }
          } else {

            if (hasNoArgs(node)) {
              if (isBuiltIn(node)) {
                return node;
              }

              if (inHTMLPosition) {
                return dyfactorHelper('is-this', isThisParams(node.path.original, filePath))
              }

              return ifHelperBlock(node.path.original, filePath);
            }
          }

          if (hasParams(node)) {
            node.params = wrapParams(params, filePath);
          }

          return node;
        },

        AttrNode: {
          enter() {
            inHTMLPosition = true;
          },
          exit() {
            inHTMLPosition = false;
          }
        },

        HashPair(node) {
          if (isPathExpression(node.value)) {
            if (isBlockParam(node.value)) return;

            let params =  isThisParams(node.value.original, filePath);
            node.value = dyfactorSexpr('is-this', params);
          }

          return node;
        },

        SubExpression(node: AST.SubExpression) {
          if (isSynthetic(node)) return node;
          if (hasParams(node)) {
            node.params = wrapParams(node.params, filePath);
          }

          return node;
        }
      }
    };
  }
}

function shouldUpdate(data: string[], node: AST.PathExpression) {
  let head = node.parts[0];
  return (data.includes(node.original) || data.includes(head));
}

function applyTelemetry(data: string[]) {
  return (env) => {
    let { builders: b } = env.syntax;
    return {
      PathExpression(node) {
        if (shouldUpdate(data, node)) {
          node.original = `this.${node.original}`;
        }
        return node;
      }
    }
  }
}

export default class extends AbstractDynamicPlugin {
  instrument() {
    fs.writeFileSync(`./app/helpers/-dyfactor-is-this.js`, isThisHelper);
    fs.writeFileSync(`./app/helpers/-dyfactor-is-component.js`, isComponentHelper);
    fs.writeFileSync(`./app/helpers/-dyfactor-is-helper.js`, isHelperHelper);
    this.inputs.filter((input) => {
      return path.extname(input) === '.hbs';
    }).forEach((path) => {
      let content = fs.readFileSync(path, 'utf8');
      let ast = preprocess(content, {
        plugins: {
          ast: [wrapPotentialLocals(path)]
        }
      });
      fs.writeFileSync(path, print(ast));
    });
  }

  modify(telemetry: Telemetry) {
    telemetry.data.forEach((datalet) => {
      Object.keys(datalet).forEach((template: string) => {
        let content = fs.readFileSync(template, 'utf8');
        let data: string[] = datalet[template];
        let { code } = tRecast.transform(content, applyTelemetry(data));
        fs.writeFileSync(template, code);
      });
    });
  }
}

function isPathExpression(param: AST.Node): param is AST.PathExpression {
  return param.type === 'PathExpression';
}

function isComponentLike(node: AST.MustacheStatement) {
  return typeof node.path.original === 'string' && node.path.original.includes('-');
}

function isMustache(node: AST.MustacheStatement): node is AST.MustacheStatement {
  return node.type === 'MustacheStatement';
}

function isBuiltIn(node: AST.MustacheStatement) {
  return node.path.original === 'input' ||
         node.path.original === 'textarea' ||
         node.path.original === 'yield';
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

function hasParams(node: AST.MustacheStatement | AST.SubExpression) {
  return node.params.length > 0;
}

function hasBlockParams(node: AST.Program) {
  return node.blockParams.length > 0;
}