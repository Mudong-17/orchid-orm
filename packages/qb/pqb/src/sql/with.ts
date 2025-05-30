import { toSQL, ToSQLCtx } from './toSQL';
import { WithItem, WithOptions } from './types';
import { emptyObject, Expression } from 'orchid-core';
import { getSqlText } from './utils';

export const pushWithSql = (ctx: ToSQLCtx, items: WithItem[]) => {
  if (!items.length) return;

  ctx.sql.push(
    'WITH',
    items
      .map((item) => {
        let inner: string;
        if (item.q) {
          inner = getSqlText(toSQL(item.q, ctx));
        } else {
          inner = (item.s as Expression).toSQL(ctx, `"${item.n}"`);
        }

        const o = item.o ?? (emptyObject as WithOptions);
        return `${o.recursive ? 'RECURSIVE ' : ''}"${item.n}"${
          o.columns ? `(${o.columns.map((x) => `"${x}"`).join(', ')})` : ''
        } AS ${
          o.materialized
            ? 'MATERIALIZED '
            : o.notMaterialized
            ? 'NOT MATERIALIZED '
            : ''
        }(${inner})`;
      })
      .join(', '),
  );
};
