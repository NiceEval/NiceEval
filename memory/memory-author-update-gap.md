# Memory author updates lack a managed boundary

Changing a structured Memory author region without a dedicated CLI boundary risks rewriting history, legacy entries, or published authors.

The managed update must limit its scope to the current author region before the resolution-history marker.
