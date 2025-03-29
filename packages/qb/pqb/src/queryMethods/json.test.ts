import {
  expectQueryNotMutated,
  User,
  userColumnsSql,
  UserSoftDelete,
} from '../test-utils/test-utils';
import { assertType, expectSql, useTestDatabase } from 'test-utils';

describe('json methods', () => {
  useTestDatabase();

  describe('json', () => {
    it('wraps a query with json functions', () => {
      const query = User.all();
      const q = query.where({ id: 1 }).json();

      assertType<Awaited<typeof q>, string | undefined>();

      expectSql(
        q.toSQL(),
        `
          SELECT COALESCE(json_agg(row_to_json(t.*)), '[]')
          FROM (
            SELECT ${userColumnsSql} FROM "user"
            WHERE "user"."id" = $1
          ) "t"
        `,
        [1],
      );

      expectQueryNotMutated(query);
    });

    it('supports `take`', () => {
      const query = User.all();
      const q = query.where({ id: 1 }).take().json();

      assertType<Awaited<typeof q>, string | undefined>();

      expectSql(
        q.toSQL(),
        `
          SELECT row_to_json(t.*)
          FROM (
            SELECT ${userColumnsSql} FROM "user"
            WHERE "user"."id" = $1
            LIMIT 1
          ) "t"
        `,
        [1],
      );

      expectQueryNotMutated(query);
    });

    it('should not duplicate the default scope inside the inner `FROM` and after `AS t`', () => {
      const q = UserSoftDelete.json();

      expectSql(
        q.toSQL(),
        `
          SELECT COALESCE(json_agg(row_to_json(t.*)), '[]')
          FROM (
            SELECT "id", "name", "active", "deleted_at" "deletedAt"
            FROM "user"
            WHERE ("user"."deleted_at" IS NULL)
          ) "t"
        `,
      );
    });
  });
});
