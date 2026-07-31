import { describe, expect, it } from "vitest";
import { parseAcf } from "./acf";

describe("parseAcf", () => {
  it("finds Plane Maker object attachments and transforms", () => {
    const result = parseAcf("Seahawk.acf", `I
1200 Version
ACF
P acf/_obja/0/_obj_path objects/fuselage.obj
P acf/_obja/0/_v10_att_file_stl 1 2 3 10 20 30
P acf/_obja/0/_lighting 0
P acf/_obja/1/_obj_path "objects/cockpit glass.obj"
P acf/_obja/1/_lighting 2
`);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toMatchObject({
      path: "objects/fuselage.obj",
      position: [1, 2, 3],
      rotation: [10, 20, 30],
      role: "exterior",
    });
    expect(result.attachments[1].role).toBe("glass");
  });

  it("reads Plane Maker scalar transforms and the unprefixed record root", () => {
    const result = parseAcf("UH60.acf", `I
1200 Version
ACF
P _obja/0/_v10_att_file_stl objects/rotors.obj
P _obja/0/_v10_att_x_acf_prt_ref 1.25
P _obja/0/_v10_att_y_acf_prt_ref 2.5
P _obja/0/_v10_att_z_acf_prt_ref -3.75
P _obja/0/_v10_att_phi_ref 10
P _obja/0/_obj_hide_dataref uh60m/kill/rotors
P _obja/0/_v10_att_psi_ref 20
P _obja/0/_v10_att_the_ref 30
P _obja/0/_lighting 0
`);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      path: "objects/rotors.obj",
      position: [1.25, 2.5, -3.75],
      rotation: [30, 20, 10],
      hideDataref: "uh60m/kill/rotors",
      role: "exterior",
    });
  });

  it("classifies named cockpit and interior attachments without relying on inconsistent flags", () => {
    const result = parseAcf("Seahawk.acf", `I
1200 Version
ACF
P _obja/2/_v10_att_file_stl cockpit1.obj
P _obja/2/_obj_flags 77
P _obja/12/_v10_att_file_stl interior2.obj
P _obja/12/_obj_flags 73
`);

    expect(result.attachments.map(({ role }) => role)).toEqual(["cockpit", "interior"]);
  });
});
