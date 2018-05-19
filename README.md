# Disambiguate Locals

[![Build Status](https://travis-ci.org/dyfactor/dyfactor-plugin-disambiguate-locals.svg?branch=master)](https://travis-ci.org/dyfactor/dyfactor-plugin-disambiguate-locals)

This is a [Dynamic Dyfcator Plugin](https://github.com/dyfactor/dyfactor#dynamic-plugins) that identifies local properties that are typically resolved by Ember's property fallback functionality. This is meant to provide a migration path for [RFC#308](https://github.com/emberjs/rfcs/pull/308).

# Usage

```shell 
> yarn add dyfactor-plugin-disambiguate-locals --dev

> dyfactor run template disambiguate-locals ./app --level <extract|modify>
```

# What Does This Do?

Given a template and component that look this:

```js
import Component from '@ember/component';

export Component.extend({
  name: 'Chad',
  company: 'LinkedIn'
});
```

```hbs
<h1>{{name}}!</h1>
<h2>Company: {{company}}</h2>

<ul>
  {{#each projects as |project|}}
    <li>{{project.name}}</li>
  {{/each}}
</ul>
```

This plugin will either re-write the template to:

```diff
-  <h1>{{name}}!</h1>
+  <h1>{{this.name}}!</h1>
-  <h2>Company: {{company}}</h2>
+  <h2>Company: {{this.company}}</h2>

   <ul>
     {{#each projects as |project|}}
       <li>{{project.name}}</li>
     {{/each}}
   </ul>
```

or write a telemetry file to disk that looks like the following:

```js
{
  "./app/templates/components/top-card.hbs": ["name", "company"]
}
```
