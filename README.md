# ham-tcos-app

Ham Study: a free study guide for the US amateur radio exams, built from the
public-domain question pools published by the NCVEC. Live at
<https://ham.tcos.app>.

This is a child of [tcos-app](https://github.com/Twin-Cities-Open-Systems/tcos-app),
which hosts `tcos.app` and keeps the registry of apps on that domain.

Status: the release path is proven with a placeholder page. The study guide
itself is moved in later, file by file.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | the page (a placeholder for now) |
| `css/site.css` | shared styles |
| `robots.txt` | crawler policy |
| `deploy.sh` | `lab` and `promote` steps, driven by `hee release` |
| `release.card.v1.yaml` | the release card `hee release` reads |
| `.github/workflows/ci.yml` | `hee-check`, then publishes the lab payload from `main` |

## Releasing

Releases go through `hee release`, never by hand:

    hee release -lab              # confirm the lab serves main
    hee release -cut -yes         # release PR (the merge is the sign-off)
    hee release -promote -yes     # deploy to ham.tcos.app, signed prod tag

## Attribution

Exam questions and figures come from the National Conference of Volunteer
Examiner Coordinators (NCVEC) question pools. This project is not affiliated
with the FCC, the NCVEC or the ARRL, and is not an official exam-prep service.

## License

GPL-3.0. See `LICENSE`.
