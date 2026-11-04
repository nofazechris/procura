/** Who is acting and when. `now` is injected so time-dependent rules are testable. */
export interface ServiceContext {
  businessId: string;
  userId: string;
  now: Date;
}
