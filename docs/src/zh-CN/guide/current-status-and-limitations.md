# 当前状态和限制

尽管已经编写了数千个测试，但可能仍然存在一些漏洞，如果您遇到问题，请提交 issue。

目前没有计划支持 Postgres 以外的数据库。
因为 Postgres 是一个功能极其丰富的数据库，拥有各种扩展，几乎可以满足所有需求：
PostGis、可以替代 ElasticSearch 的扩展、可以替代 SQS/RabbitMQ/BullMQ 等工具的消息队列扩展，
以及更多功能。相比花费数月时间支持功能有限的数据库，
更令人兴奋的是通过进一步拥抱 Postgres 生态系统，使 ORM 变得更加强大。

您可以将 OrchidORM 用于连接多个数据库的应用程序，但它无法管理跨数据库的表关系。

在 `create`/`update`/`delete` 的返回子句中无法选择关系。

支持各种有用扩展的计划已经在进行中，但在实现之前，您需要使用原始 SQL 来完成这些功能。
OrchidORM 的设计允许您结合其现有功能，并在需要的地方添加少量自定义 SQL。

不支持范围数据库类型和复合自定义类型。

对于 JSON 列的搜索，目前仅提供了一些非常基础的方法，需要进一步完善。
