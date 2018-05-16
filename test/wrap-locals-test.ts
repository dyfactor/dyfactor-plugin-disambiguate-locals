import { preprocess, print } from '@glimmer/syntax';
import { wrapPotentialLocals } from '../index';

function process(html: string) {
  let ast = preprocess(html, {
    plugins: {
      ast: [wrapPotentialLocals('test.hbs')]
    }
  });
  return print(ast);
}
QUnit.module('wrap locals');

QUnit.test('helperish mustache', (assert) => {
  assert.equal(process('{{foo}}'), '{{#if (-dyfactor-is-helper "foo")}}{{foo}}{{else}}{{-dyfactor-is-this this "foo" foo "test.hbs"}}{{/if}}');
});

QUnit.test('componentish mustache', (assert) => {
  let checkComponet = `{{#if (-dyfactor-is-component "foo-bar")}}{{component "foo-bar"}}{{else}}`
  let expect = `${checkComponet}{{#if (-dyfactor-is-helper "foo-bar")}}{{foo-bar}}{{else}}{{-dyfactor-is-this this "foo-bar" foo-bar "test.hbs"}}{{/if}}{{/if}}`
  assert.equal(process('{{foo-bar}}'), expect);
});

QUnit.test('hash args', (assert) => {
  assert.equal(process('{{foo-bar a=a}}'), '{{foo-bar a=(-dyfactor-is-this this "a" a "test.hbs")}}');
});

QUnit.test('positional params', (assert) => {
  assert.equal(process('{{foo-bar a}}'), '{{foo-bar (-dyfactor-is-this this "a" a "test.hbs")}}');
});

QUnit.test('hash args with sexpr with no args', (assert) => {
  assert.equal(process('{{foo-bar a=(foo-bar)}}'), '{{foo-bar a=(foo-bar)}}');
});

QUnit.test('hash args with sexpr with hash', (assert) => {
  assert.equal(process('{{foo-bar a=(foo-bar a=a)}}'), '{{foo-bar a=(foo-bar a=(-dyfactor-is-this this "a" a "test.hbs"))}}');
});

QUnit.test('hash args with sexpr with params', (assert) => {
  assert.equal(process('{{foo-bar a=(foo-bar a)}}'), '{{foo-bar a=(foo-bar (-dyfactor-is-this this "a" a "test.hbs"))}}');
});

QUnit.test(`block params`, (assert) => {
  assert.equal(process('{{#each a as |b|}}{{b}}{{/each}}'), '{{#each (-dyfactor-is-this this "a" a "test.hbs") as |b|}}{{b}}{{/each}}');
});

QUnit.test('block params closed over mustaches', (assert) => {
  assert.equal(process('{{#each a as |b|}}{{b}}{{c}}{{/each}}'), '{{#each (-dyfactor-is-this this "a" a "test.hbs") as |b|}}{{b}}{{#if (-dyfactor-is-helper "c")}}{{c}}{{else}}{{-dyfactor-is-this this "c" c "test.hbs"}}{{/if}}{{/each}}');
});

QUnit.test('block params scopes', (assert) => {
  let firstLoop = `{{#each (-dyfactor-is-this this "a" a "test.hbs") as |b|}}{{b}}`
  let secondLoop = `{{#each (-dyfactor-is-this this "c" c "test.hbs") as |d|}}{{d}}{{b}}`;
  let ending = `{{#if (-dyfactor-is-helper "c")}}{{c}}{{else}}{{-dyfactor-is-this this "c" c "test.hbs"}}{{/if}}{{/each}}{{/each}}`;
  assert.equal(process('{{#each a as |b|}}{{b}}{{#each c as |d|}}{{d}}{{b}}{{c}}{{/each}}{{/each}}'), firstLoop + secondLoop + ending);
});

QUnit.test('BlockStatement', (assert) => {
  assert.equal(process('{{#if a}}{{/if}}'), '{{#if (-dyfactor-is-this this "a" a "test.hbs")}}{{/if}}');
});

QUnit.test('BlockStatement sexpr params', (assert) => {
  assert.equal(process('{{#if (foo-bar a)}}{{/if}}'), '{{#if (foo-bar (-dyfactor-is-this this "a" a "test.hbs"))}}{{/if}}');
});

QUnit.test('BlockStatement sexpr hash', (assert) => {
  assert.equal(process('{{#if (foo-bar a=a)}}{{/if}}'), '{{#if (foo-bar a=(-dyfactor-is-this this "a" a "test.hbs"))}}{{/if}}');
});

QUnit.test('AttrNode simple', (assert) => {
  assert.equal(process('<div class={{a}}></div>'), '<div class={{-dyfactor-is-this this \"a\" a \"test.hbs\"}}></div>');
});

QUnit.test('AttrNode helper params', (assert) => {
  assert.equal(process('<div class={{a b}}></div>'), '<div class={{a (-dyfactor-is-this this "b" b \"test.hbs\")}}></div>');
});

QUnit.test('AttrNode helper hash', (assert) => {
  assert.equal(process('<div class={{a b=c}}></div>'), '<div class={{a b=(-dyfactor-is-this this "c" c \"test.hbs\")}}></div>');
});

QUnit.test('AttrNode helper sexpr', (assert) => {
  assert.equal(process('<div class={{a b=(c d)}}></div>'), '<div class={{a b=(c (-dyfactor-is-this this "d" d \"test.hbs\"))}}></div>');
});

['textarea', 'input', 'yield', 'outlet'].forEach((builtin) => {
  QUnit.test(`builtin: {{${builtin}}}`, (assert) => {
    assert.equal(process(`{{${builtin}}}`), `{{${builtin}}}`);
  });
});