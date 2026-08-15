export interface ProfileDraftsV1 { readonly v: "reelier.profile-drafts/v1"; readonly status: "unsigned"; readonly certification: "absent"; readonly activation: "absent"; }
export function createProfileDrafts(): ProfileDraftsV1 { return Object.freeze({ v: "reelier.profile-drafts/v1", status: "unsigned", certification: "absent", activation: "absent" }); }
