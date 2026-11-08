# Building-stage 3D and a shared sun clock

Building now offers 2D plan, 3D Overview and Walk before running any people. Neighbours and cast shadows are on by default when surroundings have been added. The sun slider has morning/noon/evening presets; optional date, sky and location controls save through the existing undo history. Clear/overcast choices explain why saved cloudy weather may have little direct shadow. Fit surroundings reveals neighbouring buildings, and cutaway/peeled views remain available in Overview.

Step 3 carries the selected 3D mode forward. Sun position, cast shadows, people positions and walk cycles all use the playback clock and stop when it pauses. Lighting uses the run’s saved inputs, so subsequent editor changes cannot alter an old result. Solar position and hourly cloud use the existing engine functions; no engine, contract or sample changes were needed. Outdoor walking blocks the saved neighbour footprints.

Validation: 150 app tests, app TypeScript check, contract checks and production build pass. Five new tests cover previewing without people, engine-vector agreement, sun below the horizon, cloud cover, saved run inputs and neighbour framing/collision. Browser checks covered changing the date, clear-sky morning/evening shadows, wall-aware walking without a run, 3D carrying into simulation, and the shared playback clock. The current project was exported before testing and the latest export restored afterwards.

With shadows enabled, the display-only 850-figure stress case measured 60.0 fps in Overview and Walk in the local in-app browser. These are settled five-second readings, not a cross-device guarantee; [readings](solar-preview-fps.json). The build retains Vite’s existing large-bundle advisory.

[Morning](images/building-sun-morning.png) · [Evening](images/building-sun-evening.png) · [Walk before simulation](images/building-walk-sun.png) · [Simulation clock and sunlight](images/simulation-sun-clock.png).

The scene is a visual geometry preview, not a measurement of indoor brightness. Full-height views show intact-wall shadows; cutaway and peeled views deliberately change the displayed geometry. Neighbours are the saved blocks and heights, not automatically fetched or invented surroundings.
